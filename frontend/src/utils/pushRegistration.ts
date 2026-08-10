/**
 * Единая регистрация Service Worker для PWA/Web Push.
 *
 * Важно: Web Push в браузере работает только при активном service worker.
 * Раньше SW регистрировался побочным эффектом сервиса фоновой геолокации,
 * поэтому в сценариях без включённого трекинга push-подписка могла никогда
 * не создаться. Этот модуль выносит регистрацию в отдельный явный шаг.
 */

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null

export async function ensurePushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null
  if (!('serviceWorker' in navigator)) return null

  if (swRegistrationPromise) return swRegistrationPromise

  swRegistrationPromise = (async () => {
    try {
      const existing = await navigator.serviceWorker.getRegistration('/')
      if (existing) {
        return existing
      }
      return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    } catch (err) {
      console.warn('[Push] Не удалось зарегистрировать service worker:', err)
      return null
    }
  })()

  return swRegistrationPromise
}