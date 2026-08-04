import React from 'react'

/**
 * Регулярное выражение для поиска ссылок и телефонов в тексте.
 *
 * Захватывает:
 *   • URL со схемой:  http://…, https://…
 *   • URL без схемы:  www.example.com
 *   • Email-адреса:   user@example.com
 *   • Телефоны:       +7 (999) 123-45-67, 8-999-123-45-67, +7 999 1234567 и т.п.
 *
 * Использование именованных групп упрощает последующий разбор совпадения.
 */
const URL_REGEX =
  // eslint-disable-next-line no-useless-escape
  /(?<url>(?:https?:\/\/|www\.)[^\s<>()"']+[^\s<>()"'.,;:!?])|(?<email>[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|(?<phone>(?:\+7|8)[\s\-.()]*\d{3}[\s\-.()]*\d{3}[\s\-.]*\d{2}[\s\-.]*\d{2}|\+\d{1,3}[\s\-.()]*(?:\d[\s\-.()]*){7,13}\d)/g

/**
 * Нормализует телефон для использования в href="tel:…".
 * Оставляет только цифры и ведущий «+», приводит российский формат «8XXXXXXXXXX»
 * к каноничному «+7XXXXXXXXXX».
 */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!hasPlus && digits.length === 11 && digits.startsWith('8')) {
    return `+7${digits.slice(1)}`
  }
  return (hasPlus ? '+' : '') + digits
}

/**
 * Разбивает строку на массив React-нод, превращая найденные ссылки
 * (URL, email, телефон) в кликабельные `<a>` элементы.
 *
 * • http/https-ссылки открываются как есть в новой вкладке.
 * • Ссылки, начинающиеся с `www.`, автоматически получают префикс `https://`.
 * • Email превращается в `mailto:`-ссылку.
 * • Телефон превращается в `tel:`-ссылку — по клику мобильное устройство
 *   инициирует звонок.
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
    const isPhone = match.groups?.phone !== undefined
    let href: string
    let external = false
    if (isEmail) {
      href = `mailto:${raw}`
    } else if (isPhone) {
      href = `tel:${normalizePhone(raw)}`
    } else if (/^www\./i.test(raw)) {
      href = `https://${raw}`
      external = true
    } else {
      href = raw
      external = true
    }

    nodes.push(
      <a
        key={`lnk-${key++}`}
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
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
