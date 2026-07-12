import { useCallback, useEffect, useMemo, useState } from 'react'
import { extractApiError } from '../api/client'
import { apiListEvents, type EventItem } from '../api/events'

const MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
]

const WEEKDAYS_SHORT = [
  'вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб',
]

function parseDate(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}

export default function CalendarPage() {
  const [items, setItems] = useState<EventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiListEvents()
      setItems(data)
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const filtered = useMemo(() => {
    const withDate = items.map((e) => ({ ev: e, date: parseDate(e.event_date) }))
    if (filter === 'all') return withDate
    if (filter === 'past') {
      return withDate
        .filter((x) => x.date < today)
        .sort((a, b) => b.date.getTime() - a.date.getTime())
    }
    // upcoming
    return withDate
      .filter((x) => x.date >= today)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [items, filter, today])

  const counts = useMemo(() => {
    let upcoming = 0
    let past = 0
    for (const e of items) {
      const d = parseDate(e.event_date)
      if (d < today) past += 1
      else upcoming += 1
    }
    return { upcoming, past, all: items.length }
  }, [items, today])

  return (
    <section className="calendar-page">
      <header className="calendar-page__head">
        <div>
          <h1 className="calendar-page__title">📅 Мотокалендарь</h1>
          <p className="muted">Ближайшие мото-мероприятия</p>
        </div>
      </header>

      <div className="calendar-tabs" role="tablist" aria-label="Фильтр">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'upcoming'}
          className={`calendar-tab ${filter === 'upcoming' ? 'is-active' : ''}`}
          onClick={() => setFilter('upcoming')}
        >
          Предстоящие
          <span className="calendar-tab__count">{counts.upcoming}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'past'}
          className={`calendar-tab ${filter === 'past' ? 'is-active' : ''}`}
          onClick={() => setFilter('past')}
        >
          Прошедшие
          <span className="calendar-tab__count">{counts.past}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`calendar-tab ${filter === 'all' ? 'is-active' : ''}`}
          onClick={() => setFilter('all')}
        >
          Все
          <span className="calendar-tab__count">{counts.all}</span>
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="muted">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">📅</div>
          <p className="muted">
            {filter === 'upcoming' && 'Пока нет предстоящих мероприятий.'}
            {filter === 'past' && 'Прошедших мероприятий нет.'}
            {filter === 'all' && 'Пока нет ни одного мероприятия.'}
          </p>
        </div>
      ) : (
        <ul className="events-list">
          {filtered.map(({ ev, date }) => {
            const past = date < today
            const day = date.getDate()
            const month = MONTHS_SHORT[date.getMonth()]
            const weekday = WEEKDAYS_SHORT[date.getDay()]
            const year = date.getFullYear()
            return (
              <li
                key={ev.id}
                className={`event-card ${past ? 'is-past' : ''}`}
              >
                <div className="event-card__date" aria-hidden="true">
                  <span className="event-card__day">{day}</span>
                  <span className="event-card__month">{month}</span>
                  <span className="event-card__weekday">{weekday}</span>
                </div>
                <div className="event-card__body">
                  <h3 className="event-card__title">{ev.title}</h3>
                  {ev.description && (
                    <p className="event-card__desc">{ev.description}</p>
                  )}
                  <dl className="event-card__meta">
                    <div className="event-card__meta-row">
                      <dt aria-label="Дата">📅</dt>
                      <dd>
                        {day} {month} {year}
                      </dd>
                    </div>
                    <div className="event-card__meta-row">
                      <dt aria-label="Место">📍</dt>
                      <dd>{ev.location}</dd>
                    </div>
                    <div className="event-card__meta-row">
                      <dt aria-label="Организатор">👤</dt>
                      <dd>{ev.organizer}</dd>
                    </div>
                  </dl>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
