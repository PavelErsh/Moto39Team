import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ChatProvider } from './context/ChatContext'
import App from './App'
import { applyLowEndClass } from './utils/performance'
import './index.css'

// ---------------------------------------------------------------------------
// Заглушаем шумные логи macOS CoreLocation, которые Chrome пробрасывает
// в DevTools каждый раз, когда GPS-фикс не удалось получить (это норма для
// десктопов без GPS). Пример строки:
//   "CoreLocationProvider: CoreLocation framework reported a
//    kCLErrorLocationUnknown failure."
// Это не JS-ошибка нашего приложения — просто системный шум.
// ---------------------------------------------------------------------------
{
  const NOISE_PATTERNS = [/kCLErrorLocationUnknown/i, /CoreLocationProvider/i]
  const isNoise = (args: unknown[]): boolean =>
    args.some(
      (a) => typeof a === 'string' && NOISE_PATTERNS.some((rx) => rx.test(a)),
    )

  const wrap = (
    fn: (...args: unknown[]) => void,
  ): ((...args: unknown[]) => void) =>
    function (...args: unknown[]): void {
      if (isNoise(args)) return
      fn.apply(console, args)
    }

  console.log = wrap(console.log.bind(console))
  console.info = wrap(console.info.bind(console))
  console.warn = wrap(console.warn.bind(console))
  console.error = wrap(console.error.bind(console))
  console.debug = wrap(console.debug.bind(console))
}

// ---------------------------------------------------------------------------
// Детектим слабое устройство ДО первого рендера — так CSS-правила с классом
// .low-end сразу применятся к первой отрисовке (без "мигания" тяжёлых
// эффектов на первом кадре). См. src/utils/performance.ts и src/index.css.
// ---------------------------------------------------------------------------
applyLowEndClass()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ChatProvider>
          <App />
        </ChatProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
