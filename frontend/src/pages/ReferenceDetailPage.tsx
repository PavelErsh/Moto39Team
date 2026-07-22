import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { extractApiError } from '../api/client'
import { apiGetReference, type ReferenceItem } from '../api/references'
import { useAuth } from '../context/AuthContext'

export default function ReferenceDetailPage() {
  const { slug = '' } = useParams()
  const { user } = useAuth()
  const [item, setItem] = useState<ReferenceItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItem(await apiGetReference(slug))
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    if (slug) load()
  }, [slug, load])

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
          <div className="empty-state__icon">📖</div>
          <p className="muted">{error ?? 'Статья не найдена'}</p>
          <Link to="/reference" className="btn btn-ghost">
            ← К мотосправке
          </Link>
        </div>
      </section>
    )
  }

  return (
    <article className="reference-detail">
      <div className="reference-detail__breadcrumbs">
        <Link to="/reference" className="reference-detail__back">
          ← Мотосправка
        </Link>
        {user?.is_superuser && (
          <Link to="/admin" className="btn btn-ghost btn-sm">
            ⚙️ Редактировать
          </Link>
        )}
      </div>

      {item.category && (
        <div className="reference-detail__cat">{item.category}</div>
      )}
      <h1 className="reference-detail__title">{item.title}</h1>
      {item.summary && (
        <p className="reference-detail__summary">{item.summary}</p>
      )}

      {item.cover_image_url && (
        <div className="reference-detail__cover">
          <img src={item.cover_image_url} alt={item.title} />
        </div>
      )}

      {item.content && (
        <div className="reference-detail__content">
          {item.content.split(/\n{2,}/).map((para, idx) => (
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
          <h2 className="reference-detail__subtitle">Изображения</h2>
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
