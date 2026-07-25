/**
 * Глобальный трекер геолокации MOTO39.
 *
 * Задача: приложение должно отправлять актуальную позицию пользователя на
 * бэкенд ВСЕГДА, пока пользователь авторизован — и когда приложение
 * открыто, и когда свёрнуто, и (по возможности) когда закрыто.
 *
 * Что здесь реализовано:
 *
 *   1) НАТИВНАЯ СБОРКА (Android/iOS через Capacitor)
 *      Используется плагин `@capacitor-community/background-geolocation`:
 *      • На Android плагин держит foreground-service c постоянным
 *        уведомлением, поэтому ОС не убивает процесс, координаты
 *        доставляются даже при свёрнутом или закрытом приложении.
 *      • На iOS используются significant location changes: iOS сама
 *        будит приложение при существенных перемещениях (в т.ч. после
 *        перезагрузки телефона).
 *      Для этого также нужны правильные разрешения в AndroidManifest.xml
 *      и ключи в Info.plist — их проставляет `scripts/patch-native.mjs`.
 *
 *   2) ВЕБ (обычный браузер)
 *      Пока вкладка открыта — трекаем через `navigator.geolocation.
 *      watchPosition`. Работает на всех страницах, а не только на /map.
 *      Для доставки координат ПОСЛЕ закрытия вкладки регистрируется
 *      Service Worker (см. `public/sw.js`) и запрашивается разрешение
 *      Periodic Background Sync (Chrome/Edge для установленных PWA).
 *      В Safari/Firefox фон принципиально невозможен — SW всё равно
 *      полезен: он умеет доотправить последний фикс при следующем
 *      подключении к сети (one-shot Background Sync).
 *
 * Последний фикс всегда кэшируется:
 *   • в `localStorage` — чтобы UI мог мгновенно показать метку,
 *   • в IndexedDB — чтобы Service Worker (без доступа к localStorage)
 *     мог прочитать её и отправить сам.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import type {
  BackgroundGeolocationPlugin,
  CallbackError,
  Location as WatcherLocation,
} from '@capacitor-community/background-geolocation'
import { App as CapacitorApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'

import { API_BASE_URL, tokenStorage } from '../api/client'
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
let swRegistration: ServiceWorkerRegistration | null = null
let started = false
/** Обработчики жизненного цикла Capacitor-приложения (Android/iOS). */
let appStateListener: PluginListenerHandle | null = null
let appResumeListener: PluginListenerHandle | null = null
let appPauseListener: PluginListenerHandle | null = null
/** Обработчики жизненного цикла страницы (веб). */
let webVisibilityHandler: (() => void) | null = null
let webPageHideHandler: (() => void) | null = null

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
/**
 * Минимальный интервал Periodic Background Sync (мс). Ниже 12 минут
 * спецификация всё равно не даст — браузер сам решает, когда будить.
 */
const PERIODIC_SYNC_INTERVAL_MS = 15 * 60_000

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

// ---- localStorage-кэш ------------------------------------------------------

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

// ---- IndexedDB (для Service Worker) ---------------------------------------

const DB_NAME = 'moto39-bg'
const DB_STORE = 'kv'

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no indexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await idbOpen()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite')
      tx.objectStore(DB_STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* noop — работает только в SW-совместимых средах */
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await idbOpen()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite')
      tx.objectStore(DB_STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* noop */
  }
}

/**
 * Синхронизируем конфиг с IndexedDB, чтобы Service Worker мог сам
 * стучаться на API (например, при Periodic Background Sync после
 * закрытия вкладки). Токены могут обновиться при рефреше — вызывать
 * можно при каждом фиксе, это дёшево.
 */
async function syncConfigToIdb(): Promise<void> {
  const accessToken = tokenStorage.getAccess()
  if (!accessToken) return
  // apiUrl должен быть абсолютным, чтобы работать из SW-scope
  const apiUrl = /^https?:/i.test(API_BASE_URL)
    ? API_BASE_URL
    : new URL(API_BASE_URL, self.location.origin).toString()
  await idbSet('config', { apiUrl, accessToken })
}

// ---- Общие ----------------------------------------------------------------

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
  opts: { force?: boolean } = {},
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
  // Асинхронно кладём в IndexedDB — оттуда Service Worker сможет прочитать
  // и отправить координату даже при закрытой вкладке.
  void idbSet('lastFix', fix)
  void syncConfigToIdb()

  // 1) Оповещаем подписчиков (карта, статусная строка и т.д.).
  listeners.forEach((cb) => {
    try {
      cb(fix)
    } catch {
      /* noop */
    }
  })

  // 2) Отправляем на бэкенд, чтобы другие райдеры увидели нашу точку.
  if (!opts.force && !shouldPushToServer(lat, lng)) return
  lastPushAt = Date.now()
  lastPushedLat = lat
  lastPushedLng = lng
  try {
    await apiUpdateMyLocation({ lat, lng, accuracy })
  } catch {
    // Сеть могла отвалиться (метро, лес). Просим Service Worker
    // доотправить координату, когда сеть появится (one-shot Sync).
    void requestOneShotSync()
  }
}

/**
 * Форсированно отправить последнюю известную точку на бэкенд.
 * Используется в момент, когда приложение уходит в фон/закрывается,
 * чтобы гарантировать, что серверная БД получит свежее «last_seen».
 * Работает через `sendBeacon`, если возможно (не блокирует выгрузку
 * страницы, доставляется даже если вкладка закрывается прямо сейчас).
 */
async function flushLastFix(reason: string): Promise<void> {
  const fix = lastFix ?? loadCachedFix()
  if (!fix) return
  const accessToken = tokenStorage.getAccess()
  if (!accessToken) return

  const apiUrl = /^https?:/i.test(API_BASE_URL)
    ? API_BASE_URL
    : new URL(
        API_BASE_URL,
        typeof self !== 'undefined' ? self.location.origin : 'http://localhost',
      ).toString()

  const url = `${apiUrl}/users/me/location`
  const body = JSON.stringify({
    lat: fix.lat,
    lng: fix.lng,
    accuracy: typeof fix.accuracy === 'number' ? fix.accuracy : null,
  })

  // sendBeacon НЕ поддерживает заголовки → используем fetch с keepalive,
  // если он есть; если нет — обычный fetch.
  try {
    if (typeof fetch === 'function') {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Moto39-Bg-Reason': reason,
        },
        body,
        // keepalive гарантирует, что запрос уйдёт, даже если
        // страница/приложение уходит в background в этот же тик.
        keepalive: true,
      })
      lastPushAt = Date.now()
      lastPushedLat = fix.lat
      lastPushedLng = fix.lng
      return
    }
  } catch {
    /* noop — попробуем через beacon ниже */
  }

  try {
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon(url, blob)
    }
  } catch {
    /* noop */
  }
}

// -----------------------------------------------------------------------------
// Service Worker: регистрация + Periodic Background Sync.
// -----------------------------------------------------------------------------

async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined') return
  if (!('serviceWorker' in navigator)) return

  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    })
  } catch {
    swRegistration = null
  }
}

async function requestPeriodicSync(): Promise<void> {
  if (!swRegistration) return
  const reg = swRegistration as ServiceWorkerRegistration & {
    periodicSync?: {
      register: (tag: string, options: { minInterval: number }) => Promise<void>
    }
  }
  if (!reg.periodicSync) return

  try {
    // Проверяем permission через Permissions API (не все браузеры знают
    // о 'periodic-background-sync', поэтому обходим типы через unknown).
    if ('permissions' in navigator) {
      try {
        const perms = navigator.permissions as unknown as {
          query: (d: { name: string }) => Promise<PermissionStatus>
        }
        const status = await perms.query({ name: 'periodic-background-sync' })
        if (status.state !== 'granted') return
      } catch {
        // Браузер не знает такого permission — пробуем зарегистрировать
        // напрямую (если не разрешено, `register` кинет исключение).
      }
    }
    await reg.periodicSync.register('moto39-location-sync', {
      minInterval: PERIODIC_SYNC_INTERVAL_MS,
    })
  } catch {
    // Пользователь не давал permission, либо браузер не поддерживает —
    // это ок, просто не будет фоновой доставки для веба.
  }
}

async function requestOneShotSync(): Promise<void> {
  if (!swRegistration) return
  const reg = swRegistration as ServiceWorkerRegistration & {
    sync?: { register: (tag: string) => Promise<void> }
  }
  if (!reg.sync) return
  try {
    await reg.sync.register('moto39-location-flush')
  } catch {
    /* noop */
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

// -----------------------------------------------------------------------------
// Обработчики жизненного цикла приложения (backgrounded / resumed).
// -----------------------------------------------------------------------------

/**
 * Навешиваем слушатели `App.appStateChange` / `pause` / `resume` из
 * @capacitor/app. Смысл:
 *   • При уходе приложения в фон — делаем финальный push последней
 *     координаты «синхронно» через fetch(keepalive). Так, если Android
 *     всё-таки убьёт процесс, у сервера всё равно будет свежее
 *     `last_seen`.
 *   • При возвращении из фона — сразу форсим один свежий фикс, чтобы
 *     карта не показывала устаревшую точку 30+ секунд.
 */
async function attachNativeLifecycleHandlers(): Promise<void> {
  if (appStateListener || appPauseListener || appResumeListener) return
  try {
    appStateListener = await CapacitorApp.addListener(
      'appStateChange',
      ({ isActive }) => {
        if (isActive) {
          // Приложение вернулось на передний план. Watcher продолжает
          // работать в фоне благодаря foreground-service (Android)
          // или significant-changes (iOS), но UI имеет смысл обновить.
          void syncConfigToIdb()
        } else {
          // Уходим в фон — гарантируем, что бэкенд получит свежую точку.
          void flushLastFix('app-background')
        }
      },
    )
  } catch {
    appStateListener = null
  }
  try {
    appPauseListener = await CapacitorApp.addListener('pause', () => {
      void flushLastFix('app-pause')
    })
  } catch {
    appPauseListener = null
  }
  try {
    appResumeListener = await CapacitorApp.addListener('resume', () => {
      void syncConfigToIdb()
    })
  } catch {
    appResumeListener = null
  }
}

async function detachNativeLifecycleHandlers(): Promise<void> {
  try {
    await appStateListener?.remove()
  } catch {
    /* noop */
  }
  try {
    await appPauseListener?.remove()
  } catch {
    /* noop */
  }
  try {
    await appResumeListener?.remove()
  } catch {
    /* noop */
  }
  appStateListener = null
  appPauseListener = null
  appResumeListener = null
}

function attachWebLifecycleHandlers(): void {
  if (typeof document === 'undefined') return
  if (webVisibilityHandler || webPageHideHandler) return

  webVisibilityHandler = () => {
    if (document.visibilityState === 'hidden') {
      void syncConfigToIdb()
      // 1) Через Service Worker (Chrome/Android PWA).
      const sw =
        swRegistration?.active ?? navigator.serviceWorker?.controller
      try {
        sw?.postMessage({ type: 'flush-location' })
      } catch {
        /* noop */
      }
      // 2) Прямо сейчас, keepalive-fetch — работает во всех современных
      //    браузерах, включая мобильный Safari.
      void flushLastFix('visibility-hidden')
      // 3) One-shot sync — если сети нет сейчас, отправим позже.
      void requestOneShotSync()
    }
  }
  webPageHideHandler = () => {
    // pagehide срабатывает даже при полном закрытии вкладки (в отличие
    // от visibilitychange, который иногда не успевает).
    void flushLastFix('page-hide')
  }

  document.addEventListener('visibilitychange', webVisibilityHandler)
  window.addEventListener('pagehide', webPageHideHandler)
}

function detachWebLifecycleHandlers(): void {
  if (typeof document === 'undefined') return
  if (webVisibilityHandler) {
    document.removeEventListener('visibilitychange', webVisibilityHandler)
    webVisibilityHandler = null
  }
  if (webPageHideHandler) {
    window.removeEventListener('pagehide', webPageHideHandler)
    webPageHideHandler = null
  }
}

/**
 * Запускает трекинг. Безопасно вызывать несколько раз — повторный вызов
 * ничего не сломает, watcher создаётся только один раз.
 */
export async function startBackgroundLocation(): Promise<void> {
  // Прогружаем кеш заранее, чтобы `getLastFix()` работал сразу.
  if (!lastFix) lastFix = loadCachedFix()

  if (started) return
  started = true

  // Синхронизируем конфиг для SW сразу — вдруг сеть отвалится ещё до
  // первого фикса, но у SW уже будет закэшированная точка с прошлой сессии.
  void syncConfigToIdb()

  if (isNative()) {
    await startNativeWatcher()
    await attachNativeLifecycleHandlers()
  } else {
    startWebWatcher()
    // На вебе дополнительно поднимаем Service Worker + Periodic Sync.
    // Это единственный (кроме нативной сборки) способ доставлять
    // координаты, когда вкладка закрыта.
    await registerServiceWorker()
    await requestPeriodicSync()
    attachWebLifecycleHandlers()
  }
}

/** Полностью останавливает трекинг (вызывается при логауте). */
export async function stopBackgroundLocation(): Promise<void> {
  if (isNative()) {
    await stopNativeWatcher()
    await detachNativeLifecycleHandlers()
  } else {
    stopWebWatcher()
    detachWebLifecycleHandlers()
    // Снимаем Periodic Sync — на чужом аккаунте наши координаты не нужны.
    const reg = swRegistration as
      | (ServiceWorkerRegistration & {
          periodicSync?: { unregister: (tag: string) => Promise<void> }
        })
      | null
    try {
      await reg?.periodicSync?.unregister('moto39-location-sync')
    } catch {
      /* noop */
    }
  }
  lastPushAt = 0
  lastPushedLat = null
  lastPushedLng = null
  clearCachedFix()
  await idbDelete('lastFix')
  await idbDelete('config')
  lastFix = null
  started = false
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
