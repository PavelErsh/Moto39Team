import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { extractApiError } from '../api/client'
import { apiGetPublicUser, type PublicUser } from '../api/motorcycles'
import RiderLocationMap from '../components/RiderLocationMap'

function formatLastSeen(iso: string | null | undefined): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (diffSec < 60) return 'только что'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} мин назад`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH} ч назад`
  const diffD = Math.round(diffH / 24)
  if (diffD < 30) return `${diffD} д назад`
  const diffMo = Math.round(diffD / 30)
  if (diffMo < 12) return `${diffMo} мес назад`
  const diffY = Math.round(diffMo / 12)
  return `${diffY} г назад`
}

// Обновляем публичный профиль каждые 30 сек — так `last_seen_at` и
// точка на карте не устаревают, пока страница открыта. Сам факт этого
// запроса ещё и продвигает `last_seen_at` у текущего пользователя на
// бэкенде (см. `deps.get_current_active_user`).
const REFRESH_INTERVAL_MS = 30_000
// Локальный тик, чтобы «X мин назад» пересчитывалось, даже если сервер
// вернул тот же профиль.
const TICK_INTERVAL_MS = 30_000

export default function UserProfilePage() {
  const { username } = useParams<{ username: string }>()
  const [profile, setProfile] = useState<PublicUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!username) return
    let alive = true
    setLoading(true)
    setError(null)

    const fetchOnce = async (initial: boolean) => {
      try {
        const data = await apiGetPublicUser(username)
        if (!alive) return
        setProfile(data)
        setError(null)
      } catch (err) {
        // При периодическом опросе не показываем ошибку, чтобы не
        // «моргать» из-за случайного разрыва сети — просто оставляем
        // старый профиль. Ошибку показываем только при первой загрузке.
        if (initial && alive) setError(extractApiError(err))
      } finally {
        if (initial && alive) setLoading(false)
      }
    }

    void fetchOnce(true)
    const refreshTimer = window.setInterval(() => {
      void fetchOnce(false)
    }, REFRESH_INTERVAL_MS)
    const tickTimer = window.setInterval(
      () => setTick((n) => (n + 1) % 1_000_000),
      TICK_INTERVAL_MS,
    )

    return () => {
      alive = false
      window.clearInterval(refreshTimer)
      window.clearInterval(tickTimer)
    }
  }, [username])

  if (loading) return <div className="muted">Загрузка…</div>
  if (error) return <div className="alert alert-error">{error}</div>
  if (!profile) return null

  const initial = (profile.username[0] || '?').toUpperCase()
  const hasLocation =
    typeof profile.last_lat === 'number' &&
    typeof profile.last_lng === 'number'
  const lastSeenText = formatLastSeen(profile.last_seen_at)
  const displayName = profile.full_name || profile.username

  return (
    <section className="cabinet">
      <header className="cabinet__head">
        {profile.avatar_url ? (
          <div className="avatar avatar--image">
            <img src={profile.avatar_url} alt={profile.username} />
          </div>
        ) : (
          <div className="avatar">{initial}</div>
        )}
        <div>
          <h1 className="cabinet__name">{displayName}</h1>
          <p className="muted">@{profile.username}</p>
          {lastSeenText && (
            <p className="muted rider-profile__seen">
              был(а) на связи {lastSeenText}
            </p>
          )}
        </div>
      </header>

      <div className="rider-profile__map-block">
        <div className="garage__head">
          <h2 className="garage__title">📍 Последнее местоположение</h2>
        </div>
        {hasLocation ? (
          <>
            <div className="rider-map-wrap">
              <RiderLocationMap
                lat={profile.last_lat as number}
                lng={profile.last_lng as number}
                label={`${displayName}${
                  lastSeenText ? ` · ${lastSeenText}` : ''
                }`}
              />
            </div>
            <p className="muted rider-profile__coords">
              {(profile.last_lat as number).toFixed(5)},{' '}
              {(profile.last_lng as number).toFixed(5)}
              {lastSeenText ? `  ·  обновлено ${lastSeenText}` : ''}
            </p>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state__icon">🗺️</div>
            <p className="muted">
              Пользователь ещё не делился своей геолокацией.
            </p>
          </div>
        )}
      </div>

      <div className="garage__head">
        <h2 className="garage__title">🏍️ Гараж</h2>
        <Link to="/riders" className="btn btn-ghost btn-sm">
          Все райдеры
        </Link>
      </div>

      {profile.motorcycles.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">🏍️</div>
          <p className="muted">У пользователя пока нет мотоциклов</p>
        </div>
      ) : (
        <div className="moto-list">
          {profile.motorcycles.map((m) => (
            <article key={m.id} className="moto-card">
              {m.photo_url ? (
                <div className="moto-card__photo">
                  <img src={m.photo_url} alt={`${m.brand} ${m.model}`} />
                </div>
              ) : (
                <div className="moto-card__photo moto-card__photo--empty">
                  🏍️
                </div>
              )}
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
