/**
 * Глобальный трекер геолокации MOTO39.
 *
 * Отслеживание работает ВСЕГДА, пока пользователь авторизован — независимо
 * от того, открыта ли страница «Карта». Сервис запускается один раз из
 * `AuthContext` сразу после логина и живёт всё время сессии.
 *
 *   • В нативной сборке Capacitor (Android/iOS) используем плагин
 *     `@capacitor-community/background-geolocation`. Он держит на Android
 *     foreground-service с постоянным уведомлением, поэтому ОС не убивает
 *     процесс, и координаты приходят даже когда приложение свёрнуто или
 *     экран телефона выключен. На iOS используются significant location
 *     changes (в фоне и после перезагрузки телефона).
 *
 *   • В веб-браузере фон невозможен (браузеры не дают JS работать после
 *     сворачивания вкладки), но пока вкладка открыта — мы всё равно шлём
 *     координаты через `navigator.geolocation.watchPosition`, независимо
 *     от того, на какой странице сейчас находится пользователь. Последний
 *     фикс кэшируется в `localStorage`, чтобы при возврате на «Карту»
 *     пользователь сразу увидел себя, не дожидаясь нового GPS-сигнала.
 *
 * Другие компоненты (в первую очередь `MapPage`) подписываются на
 * обновления координат через `subscribeLocation()` — так у нас один
 * источник правды и не запускается несколько параллельных `watchPosition`.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import type {
  BackgroundGeolocationPlugin,
  CallbackError,
  Location as WatcherLocation,
} from '@capacitor-community/background-geolocation'

import { apiUpdateMyLocation } from '../api/motorcycles'

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
  'BackgroundGeolocation',
)

// -----------------------------------------------------------------------------
// Публичный контракт сервиса.
// -----------------------------------------------------------------------------

export interface LocationFix {
  lat: number
  lng: number
  /** Погрешность в метрах, если её сообщила ОС. */
  accuracy: number | null
  /** Локальное время получения фикса (мс с эпохи). */
  timestamp: number
}

type Listener = (fix: LocationFix) => void

// -----------------------------------------------------------------------------
// Внутреннее состояние.
// -----------------------------------------------------------------------------

const listeners = new Set<Listener>()

/** Ключ в localStorage, где кешируем последнюю известную точку. */
const LAST_FIX_KEY = 'moto39_last_location'

let nativeWatcherId: string | null = null
let webWatchId: number | null = null
let lastPushAt = 0
let lastPushedLat: number | null = null
let lastPushedLng: number | null = null
let lastFix: LocationFix | null = null

/**
 * Минимальный интервал между отправками координат на бэкенд, мс.
 * Слишком часто слать не нужно: нагрузка на сеть/батарею.
 */
const MIN_PUSH_INTERVAL_MS = 30_000
/**
 * Минимальное смещение (в градусах, ~11 м), при котором форсим отправку
 * до истечения интервала — райдер реально куда-то поехал.
 */
const MIN_MOVE_DELTA = 0.0001
/** Дистанционный фильтр нативного плагина (метры). Экономит батарею. */
const DISTANCE_FILTER_M = 20
/**
 * Максимально допустимая погрешность (в метрах) для веб-фиксов.
 * Всё, что хуже — считаем грубым IP/Wi-Fi фиксом и игнорируем, ждём
 * настоящий GPS-сигнал.
 */
const WEB_ACCURACY_THRESHOLD_M = 500

// -----------------------------------------------------------------------------
// Утилиты.
// -----------------------------------------------------------------------------

/** Работаем ли мы сейчас в нативной обёртке Capacitor (а не в браузере). */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

function loadCachedFix(): LocationFix | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LAST_FIX_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LocationFix
    if (
      typeof parsed?.lat === 'number' &&
      typeof parsed?.lng === 'number' &&
      !Number.isNaN(parsed.lat) &&
      !Number.isNaN(parsed.lng)
    ) {
      return parsed
    }
  } catch {
    /* noop */
  }
  return null
}

function saveCachedFix(fix: LocationFix): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LAST_FIX_KEY, JSON.stringify(fix))
  } catch {
    /* noop */
  }
}

function clearCachedFix(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(LAST_FIX_KEY)
  } catch {
    /* noop */
  }
}

/**
 * Последняя известная точка (или из памяти, или из кэша localStorage).
 * Позволяет карте моментально показать пользователя, пока приходит
 * новый GPS-фикс.
 */
export function getLastFix(): LocationFix | null {
  if (lastFix) return lastFix
  const cached = loadCachedFix()
  if (cached) lastFix = cached
  return lastFix
}

/**
 * Подписаться на обновления координат. Возвращает функцию отписки.
 * Сразу после подписки колбэк дёргается с последним известным фиксом,
 * если он есть (чтобы UI не ждал новый цикл GPS).
 */
export function subscribeLocation(cb: Listener): () => void {
  listeners.add(cb)
  const cached = getLastFix()
  if (cached) {
    try {
      cb(cached)
    } catch {
      /* noop */
    }
  }
  return () => {
    listeners.delete(cb)
  }
}

function shouldPushToServer(lat: number, lng: number): boolean {
  const now = Date.now()
  const movedEnough =
    lastPushedLat === null ||
    lastPushedLng === null ||
    Math.abs(lastPushedLat - lat) > MIN_MOVE_DELTA ||
    Math.abs(lastPushedLng - lng) > MIN_MOVE_DELTA
  if (now - lastPushAt >= MIN_PUSH_INTERVAL_MS) return true
  if (movedEnough && now - lastPushAt > 5_000) return true
  return false
}

async function handleFix(
  lat: number,
  lng: number,
  accuracy: number | null,
): Promise<void> {
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    Number.isNaN(lat) ||
    Number.isNaN(lng)
  ) {
    return
  }

  const fix: LocationFix = {
    lat,
    lng,
    accuracy,
    timestamp: Date.now(),
  }
  lastFix = fix
  saveCachedFix(fix)

  // 1) Оповещаем подписчиков (карта, статусная строка и т.д.).
  listeners.forEach((cb) => {
    try {
      cb(fix)
    } catch {
      /* noop */
    }
  })

  // 2) Отправляем на бэкенд, чтобы другие райдеры увидели нашу точку.
  if (!shouldPushToServer(lat, lng)) return
  lastPushAt = Date.now()
  lastPushedLat = lat
  lastPushedLng = lng
  try {
    await apiUpdateMyLocation({ lat, lng, accuracy })
  } catch {
    // Тихо игнорируем: сеть могла отвалиться (метро, лес).
    // При следующем фиксе попробуем ещё раз. Не критично для UX.
  }
}

// -----------------------------------------------------------------------------
// Нативный watcher (Android/iOS через Capacitor).
// -----------------------------------------------------------------------------

async function startNativeWatcher(): Promise<void> {
  if (nativeWatcherId !== null) return
  try {
    const id = await BackgroundGeolocation.addWatcher(
      {
        // Текст постоянного уведомления, которое Android показывает,
        // пока работает foreground-service (иначе ОС прибьёт процесс).
        // На iOS уведомление не показывается.
        backgroundMessage:
          'MOTO39 показывает вашу позицию другим райдерам на карте.',
        backgroundTitle: 'MOTO39 · Трекинг активен',
        requestPermissions: true,
        stale: false,
        distanceFilter: DISTANCE_FILTER_M,
      },
      (location?: WatcherLocation, error?: CallbackError) => {
        if (error) {
          // NOT_AUTHORIZED — пользователь запретил геолокацию.
          // Можно вручную открыть настройки через openLocationSettings().
          return
        }
        if (!location) return
        const { latitude, longitude, accuracy } = location
        void handleFix(
          latitude,
          longitude,
          typeof accuracy === 'number' ? accuracy : null,
        )
      },
    )
    nativeWatcherId = id
  } catch {
    // Плагин недоступен (например, старая нативная сборка) — тихо выходим.
    nativeWatcherId = null
  }
}

async function stopNativeWatcher(): Promise<void> {
  if (nativeWatcherId === null) return
  try {
    await BackgroundGeolocation.removeWatcher({ id: nativeWatcherId })
  } catch {
    /* noop */
  }
  nativeWatcherId = null
}

// -----------------------------------------------------------------------------
// Веб-watcher (пока вкладка открыта — работает даже если пользователь
// не находится на странице «Карта»).
// -----------------------------------------------------------------------------

function startWebWatcher(): void {
  if (webWatchId !== null) return
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return

  try {
    webWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        if (
          typeof latitude !== 'number' ||
          typeof longitude !== 'number' ||
          Number.isNaN(latitude) ||
          Number.isNaN(longitude)
        ) {
          return
        }
        // Отбрасываем «мусорные» IP/Wi-Fi фиксы, если у нас уже есть
        // более точная точка.
        if (
          accuracy > WEB_ACCURACY_THRESHOLD_M &&
          (!lastFix || accuracy > (lastFix.accuracy ?? Infinity))
        ) {
          return
        }
        void handleFix(latitude, longitude, accuracy)
      },
      () => {
        // Ошибки геолокации (denied / unavailable / timeout) — тихо
        // игнорируем: без координат карта просто не покажет нашу метку,
        // остальные функции приложения работают.
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30_000,
      },
    )
  } catch {
    webWatchId = null
  }
}

function stopWebWatcher(): void {
  if (webWatchId === null) return
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    webWatchId = null
    return
  }
  try {
    navigator.geolocation.clearWatch(webWatchId)
  } catch {
    /* noop */
  }
  webWatchId = null
}

// -----------------------------------------------------------------------------
// Публичное API.
// -----------------------------------------------------------------------------

/**
 * Запускает трекинг. Безопасно вызывать несколько раз — повторный вызов
 * ничего не сломает, watcher создаётся только один раз.
 */
export async function startBackgroundLocation(): Promise<void> {
  // Прогружаем кеш заранее, чтобы `getLastFix()` работал сразу.
  if (!lastFix) lastFix = loadCachedFix()

  if (isNative()) {
    await startNativeWatcher()
  } else {
    startWebWatcher()
  }
}

/** Полностью останавливает трекинг (вызывается при логауте). */
export async function stopBackgroundLocation(): Promise<void> {
  if (isNative()) {
    await stopNativeWatcher()
  } else {
    stopWebWatcher()
  }
  lastPushAt = 0
  lastPushedLat = null
  lastPushedLng = null
  // Сам кэш последней точки чистим — на другом аккаунте она нам не нужна.
  clearCachedFix()
  lastFix = null
}

/** Открыть системные настройки приложения (только в нативной сборке). */
export async function openLocationSettings(): Promise<void> {
  if (!isNative()) return
  try {
    await BackgroundGeolocation.openSettings()
  } catch {
    /* noop */
  }
}
