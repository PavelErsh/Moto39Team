/* eslint-disable no-restricted-globals */
/**
 * Service Worker MOTO39.
 *
 * Три задачи:
 *
 *   1) Быть «инсталляционным» SW, чтобы браузер согласился установить
 *      сайт как PWA. Без активного SW Chrome/Android не даст кнопку
 *      «Установить приложение».
 *
 *   2) Кэшировать статику (index.html + бандлы) по стратегии
 *      network-first-with-fallback: онлайн — всегда свежая версия,
 *      оффлайн — приложение всё равно открывается из кэша.
 *
 *   3) Доставлять последнюю известную геопозицию на бэкенд, когда
 *      вкладка/приложение временно спит:
 *
 *      • Periodic Background Sync (только Chrome/Android для установленных
 *        PWA, не Safari, не Firefox) — SW сам просыпается раз в ~15 мин,
 *        читает точку из IndexedDB и делает POST на бэкенд.
 *      • One-shot Background Sync — если основной поток не смог
 *        отправить координату (нет сети), SW дождётся сети и повторит.
 *      • Сообщение `flush-location` от страницы — например, когда
 *        вкладка уходит в фон.
 *
 * ВАЖНОЕ ОГРАНИЧЕНИЕ: SW не может «крутиться» бесконечно. Даже когда
 * пользователь разрешил всё, что можно, браузер убивает SW через 30 сек
 * без событий. Настоящий 24/7 GPS-трекинг в вебе невозможен — для этого
 * есть нативная сборка Capacitor (см. src/services/backgroundLocation.ts).
 */

const CACHE_VERSION = 'moto39-v3'
const FONT_CACHE = 'moto39-fonts-v1'
const DB_NAME = 'moto39-bg'
const DB_STORE = 'kv'

// Файлы, которые кладём в кэш при установке SW, чтобы приложение
// открывалось даже без сети (offline shell). Всё остальное кэшируется
// по мере первого запроса.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/logo.jpeg',
  '/pager.jpeg',
]

// -----------------------------------------------------------------------------
// IndexedDB для передачи данных между страницей и SW.
// -----------------------------------------------------------------------------

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbSet(key, value) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    const store = tx.objectStore(DB_STORE)
    const req = store.put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  }))
}

async function setStoredBadgeCount(nextCount) {
  const safeCount = Math.max(0, Number(nextCount) || 0)
  await idbSet('badgeCount', safeCount)
  const nav = self.navigator
  try {
    if (safeCount > 0 && nav && typeof nav.setAppBadge === 'function') {
      await nav.setAppBadge(safeCount)
      return
    }
    if (nav && typeof nav.clearAppBadge === 'function') {
      await nav.clearAppBadge()
      return
    }
    if (nav && typeof nav.setAppBadge === 'function') {
      await nav.setAppBadge(0)
    }
  } catch {
    // Badging API недоступен/запрещён — просто молча игнорируем.
  }
}

async function incrementStoredBadgeCount(delta) {
  const current = Number(await idbGet('badgeCount')) || 0
  await setStoredBadgeCount(current + (Number(delta) || 0))
}

async function idbGet(key) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly')
    const store = tx.objectStore(DB_STORE)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

// -----------------------------------------------------------------------------
// Жизненный цикл SW.
// -----------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Прогреваем кэш со «скелетом» приложения.
      try {
        const cache = await caches.open(CACHE_VERSION)
        await cache.addAll(PRECACHE_URLS)
      } catch {
        // Не критично: конкретные файлы могут ещё не быть на сервере
        // при первой сборке. Кэш подхватит их при первом реальном запросе.
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Чистим кэши старых версий.
      const keys = await caches.keys()
      const keep = new Set([CACHE_VERSION, FONT_CACHE])
      await Promise.all(
        keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

// -----------------------------------------------------------------------------
// Стратегия ответов:
//   • навигационные (SPA-переходы) — network first, fallback на /index.html
//     (это то, что позволяет установленному PWA открываться без интернета);
//   • статические ассеты (JS/CSS/иконки/шрифты) — stale-while-revalidate;
//   • все запросы к /api/** пропускаем «как есть» — их кэшировать нельзя,
//     они авторизованные и меняются.
// -----------------------------------------------------------------------------

function isApiRequest(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/media/')
  )
}

function isAssetRequest(req) {
  const dest = req.destination
  return (
    dest === 'script' ||
    dest === 'style' ||
    dest === 'image' ||
    dest === 'font'
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  // Google Fonts — stale-while-revalidate в отдельном долговременном
  // кэше. На слабых устройствах шрифты — один из самых заметных
  // источников «долгой загрузки»: пока они летят, текст либо мигает,
  // либо блокирует layout. Кладём их в кэш один раз — и дальше
  // приложение открывается офлайн-моментально.
  if (
    url.host === 'fonts.googleapis.com' ||
    url.host === 'fonts.gstatic.com'
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(FONT_CACHE)
        const cached = await cache.match(request)
        const network = fetch(request)
          .then((resp) => {
            if (resp && (resp.status === 200 || resp.type === 'opaque')) {
              cache.put(request, resp.clone()).catch(() => {})
            }
            return resp
          })
          .catch(() => null)
        return cached || (await network) || new Response('', { status: 504 })
      })(),
    )
    return
  }

  if (url.origin !== self.location.origin) return
  if (isApiRequest(url)) return

  // Навигация — network first.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          const cache = await caches.open(CACHE_VERSION)
          cache.put('/index.html', fresh.clone()).catch(() => {})
          return fresh
        } catch {
          const cached = await caches.match('/index.html')
          if (cached) return cached
          // Совсем нет — минимальная заглушка, чтобы не белый экран.
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>MOTO39</title>' +
              '<body style="background:#0e1210;color:#f5f5f5;font:16px system-ui;' +
              'display:flex;align-items:center;justify-content:center;height:100vh;">' +
              'Нет соединения</body>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          )
        }
      })(),
    )
    return
  }

  // Ассеты — отдаём из кэша, параллельно обновляем.
  if (isAssetRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION)
        const cached = await cache.match(request)
        const network = fetch(request)
          .then((resp) => {
            if (resp && resp.status === 200) {
              cache.put(request, resp.clone()).catch(() => {})
            }
            return resp
          })
          .catch(() => null)
        return cached || (await network) || new Response('', { status: 504 })
      })(),
    )
  }
})

// -----------------------------------------------------------------------------
// Push-уведомления (Web Push API)
// -----------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  if (!event.data) return

  event.waitUntil(
    (async () => {
      let payload
      try {
        payload = event.data.json()
      } catch {
        // Не JSON — не показываем
        return
      }

      const title = payload.title || 'MOTO39'
      const options = {
        body: payload.body || '',
        icon: payload.icon || '/icon-192.png',
        badge: payload.badge || '/icon-192.png',
        tag: payload.tag || '',
        data: payload.data || {},
        requireInteraction: false,
        vibrate: [200, 100, 200],
      }

      if (typeof payload.badgeCount === 'number') {
        await setStoredBadgeCount(payload.badgeCount)
      } else {
        await incrementStoredBadgeCount(1)
      }

      await self.registration.showNotification(title, options)
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/'
  const roomId = event.notification.data?.room_id

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      // Если уже есть открытая вкладка — сфокусироваться на ней
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus()
          // Отправляем сообщение чтобы приложение перешло в нужный чат
          if (roomId) {
            client.postMessage({
              type: 'navigate-chat',
              roomId,
            })
          }
          return
        }
      }

      // Иначе — открыть новую вкладку
      if (self.clients.openWindow) {
        const targetUrl = roomId ? `/chat?room=${roomId}` : url
        await self.clients.openWindow(targetUrl)
      }
    })(),
  )
})

// -----------------------------------------------------------------------------
// Отправка последней сохранённой координаты на бэкенд.
// -----------------------------------------------------------------------------

async function pushLastLocation(reason) {
  try {
    const fix = await idbGet('lastFix')
    const config = await idbGet('config')
    if (!fix || !config || !config.apiUrl || !config.accessToken) return

    const body = JSON.stringify({
      lat: fix.lat,
      lng: fix.lng,
      accuracy: typeof fix.accuracy === 'number' ? fix.accuracy : null,
    })

    await fetch(`${config.apiUrl}/users/me/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.accessToken}`,
        'X-Moto39-Bg-Reason': reason || 'sync',
      },
      body,
      keepalive: true,
    })
  } catch {
    // Тихо игнорируем — попробуем в следующий раз.
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'moto39-location-sync') {
    event.waitUntil(pushLastLocation('periodic'))
  }
})

self.addEventListener('sync', (event) => {
  if (event.tag === 'moto39-location-flush') {
    event.waitUntil(pushLastLocation('sync'))
  }
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'flush-location') {
    event.waitUntil(pushLastLocation('message'))
  }
  if (data.type === 'skip-waiting') {
    self.skipWaiting()
  }
  if (data.type === 'set-badge-count') {
    event.waitUntil(setStoredBadgeCount(data.count))
  }
})
