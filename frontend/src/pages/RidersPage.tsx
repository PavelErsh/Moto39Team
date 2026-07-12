import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { extractApiError } from '../api/client'
import { apiListUsers, type PublicUser } from '../api/motorcycles'

export default function RidersPage() {
  const [users, setUsers] = useState<PublicUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    apiListUsers()
      .then((data) => {
        if (alive) setUsers(data)
      })
      .catch((err) => {
        if (alive) setError(extractApiError(err))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <section className="riders">
      <header className="garage__head">
        <div>
          <h1 className="garage__title">Райдеры</h1>
          <p className="muted">Кликни, чтобы увидеть гараж</p>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? (
        <div className="muted">Загрузка…</div>
      ) : users.length === 0 ? (
        <div className="muted">Пусто</div>
      ) : (
        <div className="riders-grid">
          {users.map((u) => {
            const initial = (u.username[0] || '?').toUpperCase()
            return (
              <Link
                key={u.id}
                to={`/u/${encodeURIComponent(u.username)}`}
                className="rider-card"
              >
                <div className="avatar rider-card__avatar">{initial}</div>
                <div className="rider-card__body">
                  <div className="rider-card__name">
                    {u.full_name || u.username}
                  </div>
                  <div className="muted">@{u.username}</div>
                  <div className="rider-card__count">
                    🏍 {u.motorcycles.length}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
