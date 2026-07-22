import { useEffect } from 'react'
import twemoji from '@twemoji/api'

/**
 * Заменяет unicode-эмодзи на SVG-картинки Twemoji.
 * Нужно для iOS-симулятора и старых Android/embedded WebView,
 * где отсутствует шрифт цветных эмодзи и вместо них рисуется "?".
 *
 * Хук навешивает MutationObserver на body, чтобы обрабатывать
 * элементы, добавленные позже (модалки, динамический контент).
 */
export function useTwemoji() {
  useEffect(() => {
    const parse = (node: HTMLElement) => {
      twemoji.parse(node, {
        folder: 'svg',
        ext: '.svg',
        base: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/',
        className: 'twemoji',
      })
    }

    // первый прогон
    parse(document.body)

    // и следим за изменениями DOM
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            parse(node as HTMLElement)
          } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
            parse(node.parentElement)
          }
        })
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => observer.disconnect()
  }, [])
}
