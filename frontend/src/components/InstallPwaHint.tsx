import { useEffect, useState } from 'react'

/**
 * Подсказка «Установить приложение».
 *
 * Показывается в двух случаях:
 *
 *   1) Android/Chromium/Edge: браузер сам стреляет событием
 *      `beforeinstallprompt`, если сайт подходит под критерии
 *      установки (есть manifest.webmanifest, активный SW, https и т.д.).
 *      Тогда показываем нашу кнопку — по клику вызываем сохранённое
 *      событие, ОС покажет системный диалог.
 *
 *   2) iOS Safari: `beforeinstallprompt` там не существует. Мы
 *      определяем iOS-Safari по userAgent и показываем инструкцию
 *      «Поделиться → На экран Домой» с иконкой ⬆.
 *
 * Скрывается сама, если:
 *   • приложение уже запущено как standalone/PWA (display-mode: standalone,
 *     либо navigator.standalone на iOS);
 *   • пользователь закрыл подсказку — тогда прячем на 30 дней (localStorage).
 *
 * Зачем это нужно с точки зрения задачи «отслеживать позицию всегда»:
 * только УСТАНОВЛЕННОЕ PWA в Chrome/Android получает право на
 * Periodic Background Sync. Без установки браузер не даст SW доставлять
 * координаты, когда вкладка закрыта. Поэтому подсказку важно показать
 * именно тем, кто хочет, чтобы приложение «жило само».
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISS_KEY = 'moto39_install_hint_dismissed_at'
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000 // 30 дней

function wasDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < DISMISS_MS
  } catch {
    return false
  }
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    // Android/Chrome/Edge/Desktop-PWA
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
    // iOS Safari — не поддерживает display-mode, есть свой флаг.
    if ((navigator as Navigator & { standalone?: boolean }).standalone) {
      return true
    }
  } catch {
    /* noop */
  }
  return false
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isIos = /iPad|iPhone|iPod/.test(ua)
  // На iOS все браузеры под капотом WebKit, но у Chrome/Firefox нет
  // «Add to Home Screen» — работает только через Safari.
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
  return isIos && isSafari
}

export default function InstallPwaHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  )
  const [showIosHint, setShowIosHint] = useState(false)
  const [dismissed, setDismissed] = useState(() => wasDismissedRecently())

  // Слушаем beforeinstallprompt — Chrome/Edge сохранит его, чтобы мы
  // могли показать нативный диалог по клику пользователя.
  useEffect(() => {
    if (isStandalone()) return
    if (dismissed) return

    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBip as EventListener)

    // iOS Safari — показываем текстовую инструкцию сразу, если пользователь
    // не в standalone-режиме.
    if (isIosSafari()) {
      setShowIosHint(true)
    }

    // Если пользователь установил PWA прямо сейчас — прячемся.
    const onInstalled = () => {
      setDeferred(null)
      setShowIosHint(false)
    }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip as EventListener)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [dismissed])

  const handleInstallClick = async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (choice.outcome === 'accepted') {
        setDeferred(null)
      }
    } catch {
      /* noop */
    }
  }

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* noop */
    }
    setDismissed(true)
  }

  if (dismissed) return null
  if (isStandalone()) return null
  if (!deferred && !showIosHint) return null

  return (
    <div className="pwa-hint">
      <div className="pwa-hint__body">
        <div className="pwa-hint__title">📍 Установить MOTO39 как приложение</div>
        <div className="pwa-hint__text">
          Тогда ваша позиция будет обновляться на карте даже когда браузер
          закрыт — другие райдеры увидят вас в реальном времени.
        </div>
        {showIosHint && (
          <div className="pwa-hint__ios">
            В Safari нажмите «Поделиться» <span aria-hidden>⬆︎</span> и
            выберите «На экран&nbsp;«Домой»».
          </div>
        )}
      </div>
      <div className="pwa-hint__actions">
        {deferred && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleInstallClick}
          >
            Установить
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleDismiss}
        >
          Позже
        </button>
      </div>
    </div>
  )
}
