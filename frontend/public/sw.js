/* eslint-disable no-restricted-globals */
/**
 * Service Worker MOTO39.
 *
 * Основная цель — доставлять последнюю геопозицию райдера на бэкенд даже
 * тогда, когда вкладка с приложением закрыта. В браузерном вебе это
 * возможно двумя путями:
 *
 *   1) Periodic Background Sync — запускает нас с интервалом (мин. 12 мин
 *      по спецификации; фактический интервал определяет браузер по
 *      «engagement score» — как часто пользователь запускает установленное
 *      PWA). Работает в Chrome/Edge для установленных PWA.
 *
 *   2) One-shot Background Sync — если во время последней сессии не удалось
 *      отправить координату (нет сети), SW дождётся её появления и повторит.
 *
 * На все остальные браузеры (Safari, Firefox) регистрация SW тоже полезна
 * — они хотя бы кешируют статику и не отваливают приложение при потере
 * сети. Логика геолокации в фоне там просто пропускается.
 *
 * Важно: SW не имеет прямого доступа к GPS. Он читает последнюю известную
 * точку из IndexedDB (её пишет туда основной поток) и шлёт на бэкенд с
 * тем же access-токеном, что и в основном приложении.
 */

const CACHE_VERSION = 'moto39-v1'
const DB_NAME = 'moto39-bg'
const DB_STORE = 'kv'

// -----------------------------------------------------------------------------
// Мини-обёртка над IndexedDB для передачи данных между страницей и SW.
// (localStorage из SW недоступен.)
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
  // Активируемся сразу, не ждём закрытия старых вкладок.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  // Забираем контроль над уже открытыми страницами.
  event.waitUntil(
    (async () => {
      // Чистим старые кеши других версий.
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
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

// Periodic Background Sync (Chrome/Android PWA).
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'moto39-location-sync') {
    event.waitUntil(pushLastLocation('periodic'))
  }
})

// One-shot Background Sync — вызывается страницей, когда не удалось
// отправить координаты в основном потоке (нет сети).
self.addEventListener('sync', (event) => {
  if (event.tag === 'moto39-location-flush') {
    event.waitUntil(pushLastLocation('sync'))
  }
})

// Сообщения от страницы — например, «отправь прямо сейчас».
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'flush-location') {
    event.waitUntil(pushLastLocation('message'))
  }
  if (data.type === 'skip-waiting') {
    self.skipWaiting()
  }
})
