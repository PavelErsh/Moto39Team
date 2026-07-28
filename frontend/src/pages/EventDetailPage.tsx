import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { extractApiError } from '../api/client'
import { apiGetEvent, type EventItem } from '../api/events'
import { useAuth } from '../context/AuthContext'

const MONTHS_FULL = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

function parseDate(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}

/**
 * Отображает дату/диапазон дат мероприятия в человеко-читаемом виде
 * с полными названиями месяцев (для «шапки» карточки).
 *
 *   • Один день:                "16 октября 2026"
 *   • Разные дни, один месяц:   "16–18 октября 2026"
 *   • Разные месяцы, один год:  "30 октября — 2 ноября 2026"
 *   • Разные годы:              "30 декабря 2026 — 2 января 2027"
 */
function formatFullDateRange(startISO: string, endISO: string | null): string {
  const s = parseDate(startISO)
  if (!endISO || endISO === startISO) {
    return `${s.getDate()} ${MONTHS_FULL[s.getMonth()]} ${s.getFullYear()}`
  }
  const e = parseDate(endISO)
  if (s.getFullYear() !== e.getFullYear()) {
    return (
      `${s.getDate()} ${MONTHS_FULL[s.getMonth()]} ${s.getFullYear()} — ` +
      `${e.getDate()} ${MONTHS_FULL[e.getMonth()]} ${e.getFullYear()}`
    )
  }
  if (s.getMonth() !== e.getMonth()) {
    return (
      `${s.getDate()} ${MONTHS_FULL[s.getMonth()]} — ` +
      `${e.getDate()} ${MONTHS_FULL[e.getMonth()]} ${e.getFullYear()}`
    )
  }
  return (
    `${s.getDate()}–${e.getDate()} ${MONTHS_FULL[s.getMonth()]} ` +
    `${s.getFullYear()}`
  )
}

export default function EventDetailPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const [item, setItem] = useState<EventItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItem(await apiGetEvent(id))
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (id) load()
  }, [id, load])

  const dateStr = useMemo(() => {
    if (!item) return ''
    return formatFullDateRange(item.event_date, item.end_date)
  }, [item])

  if (loading) {
    return (
      <section className="references-page">
        <div className="muted">Загрузка…</div>
      </section>
    )
  }

  if (error || !item) {
    return (
      <section className="references-page">
        <div className="empty-state">
          <div className="empty-state__icon">📅</div>
          <p className="muted">{error ?? 'Мероприятие не найдено'}</p>
          <Link to="/calendar" className="btn btn-ghost">
            ← К мотокалендарю
          </Link>
        </div>
      </section>
    )
  }

  return (
    <article className="reference-detail">
      <div className="reference-detail__breadcrumbs">
        <Link to="/calendar" className="reference-detail__back">
          ← Мотокалендарь
        </Link>
        {user?.is_superuser && (
          <Link to="/admin" className="btn btn-ghost btn-sm">
            ⚙️ Редактировать
          </Link>
        )}
      </div>

      <div className="reference-detail__cat">📅 {dateStr}</div>
      <h1 className="reference-detail__title">{item.title}</h1>

      <dl className="event-detail__meta">
        <div className="event-card__meta-row">
          <dt aria-label="Место">📍</dt>
          <dd>{item.location}</dd>
        </div>
        <div className="event-card__meta-row">
          <dt aria-label="Организатор">👤</dt>
          <dd>{item.organizer}</dd>
        </div>
      </dl>

      {item.cover_image_url && (
        <div className="reference-detail__cover">
          <img src={item.cover_image_url} alt={item.title} />
        </div>
      )}

      {item.description && (
        <div className="reference-detail__content">
          {item.description.split(/\n{2,}/).map((para, idx) => (
            <p key={idx}>
              {para.split(/\n/).map((line, i, arr) => (
                <span key={i}>
                  {line}
                  {i < arr.length - 1 && <br />}
                </span>
              ))}
            </p>
          ))}
        </div>
      )}

      {item.images.length > 0 && (
        <div className="reference-detail__gallery">
          <h2 className="reference-detail__subtitle">Фото</h2>
          <div className="reference-gallery">
            {item.images.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="reference-gallery__item"
              >
                <img src={url} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}
