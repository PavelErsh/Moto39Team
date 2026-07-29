import React from 'react'

/**
 * Регулярное выражение для поиска ссылок в тексте.
 *
 * Захватывает:
 *   • URL со схемой:  http://…, https://…
 *   • URL без схемы:  www.example.com
 *   • Email-адреса:   user@example.com
 *
 * Использование именованных групп упрощает последующий разбор совпадения.
 */
const URL_REGEX =
  // eslint-disable-next-line no-useless-escape
  /(?<url>(?:https?:\/\/|www\.)[^\s<>()"']+[^\s<>()"'.,;:!?])|(?<email>[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g

/**
 * Разбивает строку на массив React-нод, превращая найденные ссылки
 * (URL и email) в кликабельные `<a>` элементы.
 *
 * • http/https-ссылки открываются как есть в новой вкладке.
 * • Ссылки, начинающиеся с `www.`, автоматически получают префикс `https://`.
 * • Email превращается в `mailto:`-ссылку.
 * • Обычный текст сохраняется без изменений.
 */
export function linkifyText(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  // Создаём новый экземпляр регэкспа, чтобы состояние `lastIndex`
  // не переносилось между вызовами функции.
  const re = new RegExp(URL_REGEX.source, 'g')

  while ((match = re.exec(text)) !== null) {
    const { index } = match
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index))
    }

    const raw = match[0]
    const isEmail = match.groups?.email !== undefined
    let href: string
    if (isEmail) {
      href = `mailto:${raw}`
    } else if (/^www\./i.test(raw)) {
      href = `https://${raw}`
    } else {
      href = raw
    }

    nodes.push(
      <a
        key={`lnk-${key++}`}
        href={href}
        target={isEmail ? undefined : '_blank'}
        rel={isEmail ? undefined : 'noopener noreferrer'}
        className="content-link"
      >
        {raw}
      </a>,
    )

    lastIndex = index + raw.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}
