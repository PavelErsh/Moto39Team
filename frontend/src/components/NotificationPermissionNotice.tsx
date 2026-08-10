import { useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'

type PermissionStateLike = 'granted' | 'denied' | 'default' | 'unsupported'

function readPermission(): PermissionStateLike {
  if (typeof window === 'undefined') return 'unsupported'
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
    if ((navigator as Navigator & { standalone?: boolean }).standalone) return true
  } catch {
    /* noop */
  }
  return false
}

export default function NotificationPermissionNotice() {
  const [permission, setPermission] = useState<PermissionStateLike>(() => readPermission())
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    const sync = () => setPermission(readPermission())
    sync()
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  const native = useMemo(() => {
    try {
      return Capacitor.isNativePlatform()
    } catch {
      return false
    }
  }, [])

  const installedPwa = isStandalone()

  if (permission === 'granted') return null
  if (permission === 'unsupported') return null

  const handleRequest = async () => {
    if (typeof Notification === 'undefined') return
    try {
      const res = await Notification.requestPermission()
      setPermission(res)
      if (res === 'denied') setShowHelp(true)
    } catch {
      setShowHelp(true)
    }
  }

  const title = permission === 'denied'
    ? 'Уведомления отключены'
    : 'Включите уведомления'

  const description = permission === 'denied'
    ? 'Системный запрос уже был отклонён. Чтобы сообщения приходили на заблокированный экран, включите уведомления для сайта/приложения в настройках браузера или ОС.'
    : 'Разрешите уведомления, чтобы новые сообщения приходили даже когда экран телефона заблокирован.'

  return (
    <div className="notice notice--warning" role="status">
      <div className="notice__body">
        <div className="notice__title">🔔 {title}</div>
        <div className="notice__text">{description}</div>
        {!native && !installedPwa && (
          <div className="notice__hint">
            Для максимально надёжной доставки установите MOTO39 на главный экран как PWA.
          </div>
        )}
        {showHelp && (
          <div className="notice__steps">
            <strong>Что сделать:</strong>
            <ol>
              <li>Откройте настройки браузера или настройки сайта MOTO39.</li>
              <li>Найдите раздел «Уведомления» и включите их.</li>
              <li>Вернитесь в приложение — статус обновится автоматически.</li>
            </ol>
          </div>
        )}
      </div>
      <div className="notice__actions">
        {permission !== 'denied' ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={handleRequest}>
            Разрешить
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowHelp((v) => !v)}>
            Как включить
          </button>
        )}
        {permission !== 'denied' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowHelp((v) => !v)}>
            Подробнее
          </button>
        )}
      </div>
    </div>
  )
}