import { useEffect, useRef, useState, type TouchEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { extractApiError } from '../api/client'
import { apiGetPublicUser, type PublicUser } from '../api/motorcycles'
import RiderLocationMap from '../components/RiderLocationMap'

function getMotorcyclePhotos(m: {
  photo_url: string | null
  photos?: string[]
}): string[] {
  const all = [...(m.photos ?? []), ...(m.photo_url ? [m.photo_url] : [])]
  return Array.from(new Set(all.filter(Boolean)))
}

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
  const [photoIndexes, setPhotoIndexes] = useState<Record<number, number>>({})
  const [lightbox, setLightbox] = useState<{
    motoId: number
    photos: string[]
    index: number
    title: string
  } | null>(null)
  const touchStartXRef = useRef<number | null>(null)

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

  useEffect(() => {
    if (!lightbox) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setLightbox(null)
        return
      }
      if (e.key === 'ArrowLeft') {
        setLightbox((prev) => {
          if (!prev || prev.photos.length <= 1) return prev
          return {
            ...prev,
            index: (prev.index - 1 + prev.photos.length) % prev.photos.length,
          }
        })
      }
      if (e.key === 'ArrowRight') {
        setLightbox((prev) => {
          if (!prev || prev.photos.length <= 1) return prev
          return {
            ...prev,
            index: (prev.index + 1) % prev.photos.length,
          }
        })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightbox])

  if (loading) return <div className="muted">Загрузка…</div>
  if (error) return <div className="alert alert-error">{error}</div>
  if (!profile) return null

  const initial = (profile.username[0] || '?').toUpperCase()
  const hasLocation =
    typeof profile.last_lat === 'number' &&
    typeof profile.last_lng === 'number'
  const lastSeenText = formatLastSeen(profile.last_seen_at)
  const displayName = profile.full_name || profile.username

  function showPrevPhoto(motoId: number, count: number) {
    if (count <= 1) return
    setPhotoIndexes((prev) => ({
      ...prev,
      [motoId]: ((prev[motoId] ?? 0) - 1 + count) % count,
    }))
  }

  function showNextPhoto(motoId: number, count: number) {
    if (count <= 1) return
    setPhotoIndexes((prev) => ({
      ...prev,
      [motoId]: ((prev[motoId] ?? 0) + 1) % count,
    }))
  }

  function setActivePhoto(motoId: number, index: number) {
    setPhotoIndexes((prev) => ({ ...prev, [motoId]: index }))
  }

  function openLightbox(motoId: number, photos: string[], index: number, title: string) {
    if (photos.length === 0) return
    setLightbox({ motoId, photos, index, title })
  }

  function showPrevLightboxPhoto() {
    setLightbox((prev) => {
      if (!prev || prev.photos.length <= 1) return prev
      return { ...prev, index: (prev.index - 1 + prev.photos.length) % prev.photos.length }
    })
  }

  function showNextLightboxPhoto() {
    setLightbox((prev) => {
      if (!prev || prev.photos.length <= 1) return prev
      return { ...prev, index: (prev.index + 1) % prev.photos.length }
    })
  }

  function handlePhotoTouchStart(e: TouchEvent<HTMLButtonElement>) {
    touchStartXRef.current = e.touches[0]?.clientX ?? null
  }

  function handlePhotoTouchEnd(
    e: TouchEvent<HTMLButtonElement>,
    motoId: number,
    count: number,
  ) {
    const startX = touchStartXRef.current
    const endX = e.changedTouches[0]?.clientX ?? null
    touchStartXRef.current = null
    if (startX == null || endX == null || count <= 1) return
    const deltaX = endX - startX
    if (Math.abs(deltaX) < 40) return
    if (deltaX < 0) showNextPhoto(motoId, count)
    else showPrevPhoto(motoId, count)
  }

  function handleLightboxTouchStart(e: TouchEvent<HTMLDivElement>) {
    touchStartXRef.current = e.touches[0]?.clientX ?? null
  }

  function handleLightboxTouchEnd(e: TouchEvent<HTMLDivElement>) {
    const startX = touchStartXRef.current
    const endX = e.changedTouches[0]?.clientX ?? null
    touchStartXRef.current = null
    if (startX == null || endX == null || !lightbox || lightbox.photos.length <= 1) return
    const deltaX = endX - startX
    if (Math.abs(deltaX) < 40) return
    if (deltaX < 0) showNextLightboxPhoto()
    else showPrevLightboxPhoto()
  }

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
          <h1 className="cabinet__name">
            {displayName}
            {profile.sponsor_badge && (
              <span
                className="sponsor-badge"
                title="Спонсор проекта"
              >
                {profile.sponsor_badge}
              </span>
            )}
          </h1>
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
          {profile.motorcycles.map((m) => {
            const photos = getMotorcyclePhotos(m)
            const activeIndex = photos.length > 0 ? Math.min(photoIndexes[m.id] ?? 0, photos.length - 1) : 0
            const coverPhoto = photos[activeIndex] ?? null

            return (
            <article key={m.id} className="moto-card">
              {coverPhoto ? (
                <div className="moto-card__photo">
                  <button
                    type="button"
                    className="moto-card__photo-button"
                    onClick={() => openLightbox(m.id, photos, activeIndex, `${m.brand} ${m.model}`)}
                    onTouchStart={handlePhotoTouchStart}
                    onTouchEnd={(e) => handlePhotoTouchEnd(e, m.id, photos.length)}
                    aria-label={`Открыть фото мотоцикла ${m.brand} ${m.model}`}
                  >
                    <img
                      src={coverPhoto}
                      alt={`${m.brand} ${m.model}`}
                    />
                  </button>
                  {photos.length > 1 && (
                    <>
                      <button
                        type="button"
                        className="moto-card__nav moto-card__nav--prev"
                        onClick={() => showPrevPhoto(m.id, photos.length)}
                        aria-label="Предыдущее фото"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="moto-card__nav moto-card__nav--next"
                        onClick={() => showNextPhoto(m.id, photos.length)}
                        aria-label="Следующее фото"
                      >
                        ›
                      </button>
                      <div className="moto-card__counter">
                        {activeIndex + 1} / {photos.length}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="moto-card__photo moto-card__photo--empty">
                  🏍️
                </div>
              )}
              {photos.length > 1 && (
                <div className="moto-card__gallery">
                  {photos.map((url, index) => (
                    <div
                      key={url}
                      className={`moto-card__thumb ${index === activeIndex ? 'is-active' : ''}`}
                    >
                      <button
                        type="button"
                        className="moto-card__thumb-button"
                        onClick={() => setActivePhoto(m.id, index)}
                        aria-label={`Показать фото ${index + 1}`}
                      >
                        <img src={url} alt={`${m.brand} ${m.model} ${index + 1}`} />
                      </button>
                    </div>
                  ))}
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
                {photos.length > 1 && (
                  <p className="muted">Фото: {photos.length}</p>
                )}
              </div>
            </article>
          )})}
        </div>
      )}

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <div
            className="lightbox"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleLightboxTouchStart}
            onTouchEnd={handleLightboxTouchEnd}
          >
            <button
              type="button"
              className="lightbox__close"
              onClick={() => setLightbox(null)}
              aria-label="Закрыть фото"
            >
              ×
            </button>
            <img
              className="lightbox__image"
              src={lightbox.photos[lightbox.index]}
              alt={lightbox.title}
            />
            {lightbox.photos.length > 1 && (
              <>
                <button
                  type="button"
                  className="lightbox__nav lightbox__nav--prev"
                  onClick={showPrevLightboxPhoto}
                  aria-label="Предыдущее фото"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="lightbox__nav lightbox__nav--next"
                  onClick={showNextLightboxPhoto}
                  aria-label="Следующее фото"
                >
                  ›
                </button>
              </>
            )}
            <div className="lightbox__caption">
              <strong>{lightbox.title}</strong>
              <span>
                {lightbox.index + 1} / {lightbox.photos.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
