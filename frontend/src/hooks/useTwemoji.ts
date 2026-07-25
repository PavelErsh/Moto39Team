import { useEffect } from 'react'
import twemoji from '@twemoji/api'
import { isLowEndDevice } from '../utils/performance'

/**
 * Заменяет unicode-эмодзи на SVG-картинки Twemoji.
 * Нужно для iOS-симулятора и старых Android/embedded WebView,
 * где отсутствует шрифт цветных эмодзи и вместо них рисуется "?".
 *
 * Оптимизации против лагов на слабых устройствах:
 *   - MutationObserver теперь батчит мутации через requestIdleCallback
 *     (или setTimeout как fallback) и парсит только уникальные узлы.
 *   - Не подписываемся на characterData (это давало вал мутаций при
 *     любом обновлении текста в React-контролах).
 *   - На low-end устройствах фолбэк работает через нативные системные
 *     эмодзи — Twemoji вообще не подключается, чтобы не грузить SVG-иконки
 *     и не гонять MutationObserver.
 */
export function useTwemoji() {
  useEffect(() => {
    // На современных устройствах системные эмодзи есть почти всегда.
    // На слабых устройствах вреда от "?" меньше, чем от постоянных
    // мутаций DOM и загрузки внешних SVG. Так что если устройство слабое —
    // просто ничего не делаем.
    if (isLowEndDevice()) return

    const parse = (node: Node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as HTMLElement
      // Пропускаем узлы, где эмодзи уже заменены — twemoji.parse и сам
      // это делает, но лишний вызов на большом поддереве стоит недёшево.
      if (el.dataset.twemojiParsed === '1') return
      twemoji.parse(el, {
        folder: 'svg',
        ext: '.svg',
        base: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/',
        className: 'twemoji',
      })
      el.dataset.twemojiParsed = '1'
    }

    // Первый прогон по body — синхронно, чтобы не мигало.
    parse(document.body)

    // Батчим все добавленные узлы за один тик и парсим только уникальные
    // «верхнеуровневые» узлы. Так избегаем повторной обработки одного
    // и того же контейнера при массовых вставках (списки, таблицы).
    const pending = new Set<HTMLElement>()
    let scheduled = false

    const ric: (cb: () => void) => number =
      (
        window as Window &
          typeof globalThis & {
            requestIdleCallback?: (cb: () => void) => number
          }
      ).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 50))

    const flush = () => {
      scheduled = false
      // Снимаем "уже обработано" со всех — это нужно, потому что содержимое
      // элемента могло реально измениться и в нём появились новые эмодзи.
      for (const node of pending) {
        delete node.dataset.twemojiParsed
        parse(node)
      }
      pending.clear()
    }

    const schedule = () => {
      if (scheduled) return
      scheduled = true
      ric(flush)
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        // Обрабатываем только добавления узлов. characterData/attributes
        // не слушаем — они генерят слишком много шума при обычных
        // ре-рендерах React.
        m.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            pending.add(node as HTMLElement)
          } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
            pending.add(node.parentElement)
          }
        })
      }
      if (pending.size > 0) schedule()
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      // characterData / attributes НЕ подписываем — см. коммент выше.
    })

    return () => {
      observer.disconnect()
      pending.clear()
    }
  }, [])
}
