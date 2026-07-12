import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { extractApiError } from '../api/client'
import { apiGetPublicUser, type PublicUser } from '../api/motorcycles'

export default function UserProfilePage() {
  const { username } = useParams<{ username: string }>()
  const [profile, setProfile] = useState<PublicUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!username) return
    let alive = true
    setLoading(true)
    setError(null)
    apiGetPublicUser(username)
      .then((data) => {
        if (alive) setProfile(data)
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
  }, [username])

  if (loading) return <div className="muted">Загрузка…</div>
  if (error) return <div className="alert alert-error">{error}</div>
  if (!profile) return null

  const initial = (profile.username[0] || '?').toUpperCase()

  return (
    <section className="cabinet">
      <header className="cabinet__head">
        <div className="avatar">{initial}</div>
        <div>
          <h1 className="cabinet__name">
            {profile.full_name || profile.username}
          </h1>
          <p className="muted">@{profile.username}</p>
        </div>
      </header>

      <div className="garage__head">
        <h2 className="garage__title">🏍 Гараж</h2>
        <Link to="/riders" className="btn btn-ghost btn-sm">
          Все райдеры
        </Link>
      </div>

      {profile.motorcycles.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">🏍</div>
          <p className="muted">У пользователя пока нет мотоциклов</p>
        </div>
      ) : (
        <div className="moto-list">
          {profile.motorcycles.map((m) => (
            <article key={m.id} className="moto-card">
              <div className="moto-card__body">
                <h3 className="moto-card__title">
                  {m.brand} {m.model}
                </h3>
                <div className="moto-card__meta">
                  {m.year && <span>{m.year}</span>}
                  {m.engine_cc && <span>{m.engine_cc} cc</span>}
                  {m.color && <span>{m.color}</span>}
                </div>
                {m.description && (
                  <p className="moto-card__desc">{m.description}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
