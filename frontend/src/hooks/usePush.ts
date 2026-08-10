/**
 * usePushSubscription — хук для подписки на Web Push-уведомления.
 *
 * При логине пользователя автоматически подписывает на Push,
 * при логауте — отписывает.
 *
 * VAPID public key должен быть доступен через бэкенд:
 *   GET /api/v1/push/vapid-public-key → { key: "..." }
 */
import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { ensurePushServiceWorker } from '../utils/pushRegistration'

const VAPID_PUBLIC_KEY_STORAGE = 'moto39_vapid_key'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

async function getVapidPublicKey(): Promise<string | null> {
  // Пробуем из localStorage
  const cached = localStorage.getItem(VAPID_PUBLIC_KEY_STORAGE)
  if (cached) return cached

  try {
    const { data } = await api.get<{ key: string }>('/push/vapid-public-key')
    if (data.key) {
      localStorage.setItem(VAPID_PUBLIC_KEY_STORAGE, data.key)
      return data.key
    }
  } catch {
    // Бэкенд может не поддерживать этот эндпоинт — не критично
  }
  return null
}

async function subscribeUser(_userId: number): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('[Push] Push API не поддерживается браузером')
    return
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    console.warn('[Push] Разрешение на уведомления запрещено пользователем')
    return
  }

  const vapidKey = await getVapidPublicKey()
  if (!vapidKey) {
    console.warn('[Push] VAPID public key не найден')
    return
  }

  try {
    const registration = await ensurePushServiceWorker()
    if (!registration) {
      console.warn('[Push] Service worker не зарегистрирован')
      return
    }

    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        console.warn('[Push] Пользователь не выдал разрешение на уведомления')
        return
      }
    }

    let subscription = await registration.pushManager.getSubscription()

    if (subscription) {
      // Уже подписан — проверяем ключ
      const currentKey = subscription.options.applicationServerKey
      if (currentKey) {
        const currentKeyStr = btoa(String.fromCharCode(...new Uint8Array(currentKey)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        if (currentKeyStr === vapidKey) {
          const rawKey = subscription.getKey('p256dh')
          const rawAuth = subscription.getKey('auth')
          if (!rawKey || !rawAuth) return
          await api.post('/push/subscribe', {
            endpoint: subscription.endpoint,
            p256dh: btoa(String.fromCharCode(...new Uint8Array(rawKey)))
              .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
            auth: btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
              .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
            user_agent: navigator.userAgent.slice(0, 500),
          })
          console.log('[Push] Подписка уже существовала и была синхронизирована с сервером')
          return
        }
      }
      await subscription.unsubscribe()
    }

    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    })

    const rawKey = subscription.getKey('p256dh')
    const rawAuth = subscription.getKey('auth')
    if (!rawKey || !rawAuth) return

    await api.post('/push/subscribe', {
      endpoint: subscription.endpoint,
      p256dh: btoa(String.fromCharCode(...new Uint8Array(rawKey)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      auth: btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      user_agent: navigator.userAgent.slice(0, 500),
    })
    console.log('[Push] Подписка сохранена')
  } catch (err) {
    console.warn('[Push] Ошибка подписки:', err)
  }
}

async function unsubscribeUser(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const registration = await ensurePushServiceWorker()
    if (!registration) return
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      await api.post('/push/unsubscribe', {
        endpoint: subscription.endpoint,
        p256dh: '',
        auth: '',
      }).catch(() => {})
      await subscription.unsubscribe()
      console.log('[Push] Отписка выполнена')
    }
  } catch {
    // ignore
  }
}

/**
 * Хук для автоматической подписки/отписки от Push.
 * Разместите <PushSubscriptionHandler /> внутри AuthProvider.
 */
export function usePushSubscription() {
  const { user } = useAuth()
  const subscribedRef = useRef(false)

  useEffect(() => {
    if (user && !subscribedRef.current) {
      subscribedRef.current = true
      subscribeUser(user.id)
    }
    if (!user) {
      subscribedRef.current = false
      unsubscribeUser()
    }
  }, [user])
}
