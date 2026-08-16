import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { extractApiError } from '../api/client'
import { apiListReferences, type ReferenceItem } from '../api/references'
import { useAuth } from '../context/AuthContext'

export default function ReferencesPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<ReferenceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await apiListReferences())
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const it of items) {
      if (it.category && it.category.trim()) set.add(it.category.trim())
    }
    return Array.from(set).sort()
  }, [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((it) => {
      if (activeCategory !== 'all' && (it.category ?? '') !== activeCategory) {
        return false
      }
      if (!q) return true
      return (
        it.title.toLowerCase().includes(q) ||
        (it.summary ?? '').toLowerCase().includes(q) ||
        (it.category ?? '').toLowerCase().includes(q)
      )
    })
  }, [items, query, activeCategory])

  const handleCategorySelect = useCallback((category: string) => {
    setActiveCategory(category)
    setIsCategoryMenuOpen(false)
  }, [])

  return (
    <section className="references-page">
      <header className="references-page__head">
        <div>
          <h1 className="references-page__title">📖 Мотосправка</h1>
          <p className="muted">
            Для внесения Ваших данных в мотосправку пишите @CrazyTony39
          </p>
        </div>
        {user?.is_superuser && (
          <Link to="/admin" className="btn btn-primary">
            ⚙️ Управлять
          </Link>
        )}
      </header>

      <div className="references-toolbar">
        <input
          type="search"
          placeholder="Поиск по статьям…"
          className="references-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {(categories.length > 0 || activeCategory !== 'all') && (
        <div className="references-categories">
          <button
            type="button"
            className={`references-categories__toggle ${
              isCategoryMenuOpen ? 'is-open' : ''
            }`}
            aria-expanded={isCategoryMenuOpen}
            aria-controls="references-categories-menu"
            onClick={() => setIsCategoryMenuOpen((prev) => !prev)}
          >
            <span>
              Категории:{' '}
              <strong>{activeCategory === 'all' ? 'Все' : activeCategory}</strong>
            </span>
            <span className="references-categories__chevron" aria-hidden="true">
              ▾
            </span>
          </button>

          <div
            id="references-categories-menu"
            className={`calendar-tabs ${
              isCategoryMenuOpen ? 'references-categories__menu is-open' : 'references-categories__menu'
            }`}
            role="tablist"
            aria-label="Категории"
            hidden={!isCategoryMenuOpen}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === 'all'}
              className={`calendar-tab ${
                activeCategory === 'all' ? 'is-active' : ''
              }`}
              onClick={() => handleCategorySelect('all')}
            >
              Все
              <span className="calendar-tab__count">{items.length}</span>
            </button>
            {categories.map((cat) => {
              const count = items.filter((i) => i.category === cat).length
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === cat}
                  className={`calendar-tab ${
                    activeCategory === cat ? 'is-active' : ''
                  }`}
                  onClick={() => handleCategorySelect(cat)}
                >
                  {cat}
                  <span className="calendar-tab__count">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="muted">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">📖</div>
          <p className="muted">
            {items.length === 0
              ? 'В справочнике пока нет ни одной статьи.'
              : 'По вашему запросу ничего не найдено.'}
          </p>
          {user?.is_superuser && items.length === 0 && (
            <Link to="/admin" className="btn btn-ghost">
              Добавить статью
            </Link>
          )}
        </div>
      ) : (
        <ul className="references-list">
          {filtered.map((it) => (
            <li key={it.id}>
              <Link
                to={`/reference/${it.slug}`}
                className="reference-card"
              >
                {it.cover_image_url && (
                  <div className="reference-card__cover">
                    <img
                      src={it.cover_image_url}
                      alt=""
                      loading="lazy"
                    />
                  </div>
                )}
                <div className="reference-card__body">
                  {it.category && (
                    <span className="reference-card__cat">{it.category}</span>
                  )}
                  <h3 className="reference-card__title">{it.title}</h3>
                  {it.summary && (
                    <p className="reference-card__summary">{it.summary}</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
