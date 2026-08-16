/**
 * Утилита для отправки нативных уведомлений.
 *
 * Поддерживает:
 *   - Web Notifications API (браузер / PWA)
 *   - Capacitor Local Notifications (нативная сборка Android/iOS)
 *
 * Использование:
 *   await notify('Новое сообщение', { body: 'Текст сообщения...' })
 */

// ── Capacitor Local Notifications ───────────────────────────────

let capacitorAvailable = false
let LocalNotifications: any = null

async function initCapacitor() {
  if (LocalNotifications !== null) return // уже инициализировано
  try {
    // используем eval-подобный подход чтобы Vite не пытался разрешить импорт
    const mod = await new Function(
      'return import("@capacitor/local-notifications")',
    )()
    LocalNotifications = mod.LocalNotifications
    capacitorAvailable = true
    // Запрашиваем разрешение один раз
    await LocalNotifications.requestPermissions()
  } catch {
    LocalNotifications = false
    capacitorAvailable = false
  }
}

// ── Web Notifications ───────────────────────────────────────────

/**
 * Запросить разрешение на показ Web-уведомлений.
 * Безопасно вызывает Notification.requestPermission().
 */
function requestWebPermission(): void {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') return
  Notification.requestPermission().catch(() => { /* noop */ })
}

/**
 * Показать web-уведомление.
 */
function showWebNotification(title: string, options: NotificationOptions): void {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, {
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      ...options,
    })
  } catch {
    /* noop */
  }
}

// ── App icon badge (PWA / поддерживаемые браузеры) ───────────────

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

/**
 * Показать бейдж на иконке установленного приложения/PWA.
 * Работает только там, где браузер и ОС поддерживают Badging API.
 */
export async function setAppIconBadge(count: number): Promise<void> {
  if (typeof window === 'undefined') return
  const nav = navigator as BadgeNavigator
  try {
    const registration = await navigator.serviceWorker?.getRegistration('/')
    registration?.active?.postMessage({ type: 'set-badge-count', count })
    if (typeof nav.setAppBadge === 'function') {
      if (count > 0) {
        await nav.setAppBadge(count)
      } else if (typeof nav.clearAppBadge === 'function') {
        await nav.clearAppBadge()
      } else {
        await nav.setAppBadge(0)
      }
    }
  } catch {
    /* noop */
  }
}

/**
 * Сбросить бейдж на иконке приложения.
 */
export async function clearAppIconBadge(): Promise<void> {
  if (typeof window === 'undefined') return
  const nav = navigator as BadgeNavigator
  try {
    const registration = await navigator.serviceWorker?.getRegistration('/')
    registration?.active?.postMessage({ type: 'set-badge-count', count: 0 })
    if (typeof nav.clearAppBadge === 'function') {
      await nav.clearAppBadge()
      return
    }
    if (typeof nav.setAppBadge === 'function') {
      await nav.setAppBadge(0)
    }
  } catch {
    /* noop */
  }
}

// ── Публичный API ───────────────────────────────────────────────

export interface NotifyOptions {
  body: string
  /** Тег для группировки/замены уведомлений (Web API). */
  tag?: string
  /** URL, который откроется при клике (Web API). */
  data?: { url?: string }
  /** Канал для Capacitor (Android). */
  channelId?: string
}

/**
 * Отправить уведомление всеми доступными способами.
 *
 * Сначала пробует Capacitor (нативное), затем Web Notifications API.
 */
export async function notify(title: string, opts: NotifyOptions): Promise<void> {
  // ── Capacitor Local Notification (Android/iOS native) ─────────
  await initCapacitor()
  if (capacitorAvailable && LocalNotifications) {
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            title,
            body: opts.body,
            id: Date.now(),
            schedule: { at: new Date(Date.now() + 100) },
            sound: undefined,
            attachments: undefined,
            actionTypeId: '',
            extra: opts.data ?? null,
            channelId: opts.channelId ?? 'chat',
          },
        ],
      })
      return // если Capacitor сработал — не дублируем web
    } catch {
      // fallback к Web Notifications
    }
  }

  // ── Web Notifications API ─────────────────────────────────────
  showWebNotification(title, {
    body: opts.body,
    tag: opts.tag || 'moto39-chat',
    data: opts.data,
  })
}

/**
 * Запросить разрешения на уведомления (при первом входе / настройках).
 */
export function requestNotificationPermissions(): void {
  requestWebPermission()
  // Capacitor разрешения запрашиваются при первом вызове notify()
  initCapacitor().catch(() => {})
}
