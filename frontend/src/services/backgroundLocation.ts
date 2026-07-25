/**
 * Фоновая геолокация через Capacitor.
 *
 * На вебе (обычный браузер) этот модуль превращается в no-op: карта уже
 * сама шлёт координаты, пока страница открыта.
 *
 * На нативной сборке (Android/iOS через Capacitor) стартуется watcher
 * плагина @capacitor-community/background-geolocation. Он:
 *   • На Android — держит foreground-service c постоянным уведомлением,
 *     благодаря чему ОС не убивает процесс даже при свёрнутом приложении.
 *   • На iOS — использует significant location changes, чтобы получать
 *     обновления координат в фоне (в т.ч. после перезагрузки телефона).
 *
 * Каждое обновление координат мы отправляем на бэкенд
 * (`POST /users/me/location`) — там уже готовая логика хранит последнюю
 * точку и раздаёт её остальным райдерам через `GET /users/locations`.
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

let watcherId: string | null = null
let lastPushAt = 0
let lastLat: number | null = null
let lastLng: number | null = null

// Минимальный интервал между отправками координат на бэкенд, мс.
// Слишком часто слать не нужно: нагрузка на сеть/батарею.
const MIN_PUSH_INTERVAL_MS = 30_000
// Минимальное расстояние (в градусах, ~11 м) при котором форсим отправку
// раньше интервала — райдер реально куда-то поехал.
const MIN_MOVE_DELTA = 0.0001
// Дистанционный фильтр плагина (метры). Плагин сам не будет присылать
// более частые обновления. Батарея скажет спасибо.
const DISTANCE_FILTER_M = 20

/** Работаем ли мы сейчас в нативной обёртке (а не в браузере). */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

function shouldPush(lat: number, lng: number): boolean {
  const now = Date.now()
  const movedEnough =
    lastLat === null ||
    lastLng === null ||
    Math.abs(lastLat - lat) > MIN_MOVE_DELTA ||
    Math.abs(lastLng - lng) > MIN_MOVE_DELTA
  if (now - lastPushAt >= MIN_PUSH_INTERVAL_MS) return true
  if (movedEnough && now - lastPushAt > 5_000) return true
  return false
}

async function pushIfNeeded(loc: WatcherLocation): Promise<void> {
  const { latitude, longitude, accuracy } = loc
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    Number.isNaN(latitude) ||
    Number.isNaN(longitude)
  ) {
    return
  }
  if (!shouldPush(latitude, longitude)) return
  lastPushAt = Date.now()
  lastLat = latitude
  lastLng = longitude
  try {
    await apiUpdateMyLocation({
      lat: latitude,
      lng: longitude,
      accuracy: typeof accuracy === 'number' ? accuracy : null,
    })
  } catch {
    // Тихо игнорируем: сеть может отсутствовать (метро, лес).
    // При следующем фиксе попробуем снова. Не критично для UX.
  }
}

/**
 * Стартует фоновый трекинг. Безопасно вызывать несколько раз —
 * повторный вызов ничего не сломает, watcher создаётся только один раз.
 */
export async function startBackgroundLocation(): Promise<void> {
  if (!isNative()) return
  if (watcherId !== null) return

  try {
    const id = await BackgroundGeolocation.addWatcher(
      {
        // Текст постоянного уведомления, которое Android держит, пока
        // работает foreground-service (иначе ОС прибьёт процесс).
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
          // Можно предложить открыть настройки: BackgroundGeolocation.openSettings()
          return
        }
        if (!location) return
        void pushIfNeeded(location)
      },
    )
    watcherId = id
  } catch {
    // Плагин не доступен (например, старая нативная сборка) — тихо выходим.
    watcherId = null
  }
}

/** Останавливает фоновый трекинг. Вызывается при логауте. */
export async function stopBackgroundLocation(): Promise<void> {
  if (!isNative()) return
  if (watcherId === null) return
  try {
    await BackgroundGeolocation.removeWatcher({ id: watcherId })
  } catch {
    /* noop */
  }
  watcherId = null
  lastPushAt = 0
  lastLat = null
  lastLng = null
}

/** Ручной перевод пользователя в системные настройки приложения. */
export async function openLocationSettings(): Promise<void> {
  if (!isNative()) return
  try {
    await BackgroundGeolocation.openSettings()
  } catch {
    /* noop */
  }
}
