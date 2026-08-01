import { useEffect, useRef } from 'react'

/**
 * Обёртка над Cloudflare Turnstile.
 *
 * Мы динамически подгружаем скрипт капчи (один раз на страницу), затем
 * рендерим виджет через ``window.turnstile.render`` в наш div. Токен от
 * капчи прокидывается наружу через onToken.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: {
          sitekey: string
          callback?: (token: string) => void
          'error-callback'?: () => void
          'expired-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
          action?: string
        },
      ) => string
      reset: (widgetId?: string) => void
      remove: (widgetId?: string) => void
    }
    __turnstileScriptPromise?: Promise<void>
  }
}

const SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (window.__turnstileScriptPromise) return window.__turnstileScriptPromise
  window.__turnstileScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_URL
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Не удалось загрузить Turnstile'))
    document.head.appendChild(s)
  })
  return window.__turnstileScriptPromise
}

interface Props {
  siteKey: string
  onToken: (token: string | null) => void
  theme?: 'light' | 'dark' | 'auto'
}

export default function TurnstileWidget({
  siteKey,
  onToken,
  theme = 'auto',
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    let cancelled = false
    if (!siteKey || !containerRef.current) return
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          callback: (token) => onTokenRef.current(token),
          'error-callback': () => onTokenRef.current(null),
          'expired-callback': () => onTokenRef.current(null),
        })
      })
      .catch(() => {
        if (!cancelled) onTokenRef.current(null)
      })

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // ignore
        }
        widgetIdRef.current = null
      }
    }
  }, [siteKey, theme])

  return <div ref={containerRef} className="turnstile-widget" />
}
