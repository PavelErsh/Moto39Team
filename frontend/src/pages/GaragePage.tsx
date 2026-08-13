import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type TouchEvent } from 'react'
import { extractApiError } from '../api/client'
import {
  apiCreateMotorcycle,
  apiDeleteMotorcycle,
  apiListMyMotorcycles,
  apiUpdateMotorcycle,
  apiUploadMotorcycleImage,
  apiUploadMotorcyclePhoto,
  type Motorcycle,
  type MotorcyclePayload,
} from '../api/motorcycles'

function toPayload(form: {
  brand: string
  model: string
  year: string
  engine_cc: string
  color: string
  description: string
  photo_url: string
  photos: string[]
}): MotorcyclePayload {
  const photos = Array.from(
    new Set(
      form.photos
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  )
  return {
    brand: form.brand.trim(),
    model: form.model.trim(),
    year: form.year ? Number(form.year) : null,
    engine_cc: form.engine_cc ? Number(form.engine_cc) : null,
    color: form.color.trim() || null,
    description: form.description.trim() || null,
    photo_url: photos[0] ?? (form.photo_url.trim() || null),
    photos,
  }
}

function getMotorcyclePhotos(m: Pick<Motorcycle, 'photo_url' | 'photos'>): string[] {
  const all = [...(m.photos ?? []), ...(m.photo_url ? [m.photo_url] : [])]
  return Array.from(new Set(all.filter(Boolean)))
}

export default function GaragePage() {
  const [items, setItems] = useState<Motorcycle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [photoIndexes, setPhotoIndexes] = useState<Record<number, number>>({})
  const [lightbox, setLightbox] = useState<{
    motoId: number
    photos: string[]
    index: number
    title: string
  } | null>(null)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)

  const [form, setForm] = useState({
    brand: '',
    model: '',
    year: '',
    engine_cc: '',
    color: '',
    description: '',
    photo_url: '',
    photos: [] as string[],
  })

  const formPhotoInputRef = useRef<HTMLInputElement>(null)
  // Для загрузки фото прямо в карточке (у уже сохранённого мотоцикла).
  // Один hidden-input используется для активного id.
  const cardPhotoInputRef = useRef<HTMLInputElement>(null)
  const [cardUploadingId, setCardUploadingId] = useState<number | null>(null)
  const touchStartXRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiListMyMotorcycles()
      setItems(data)
      setPhotoIndexes((prev) => {
        const next: Record<number, number> = {}
        for (const item of data) {
          const photos = getMotorcyclePhotos(item)
          const current = prev[item.id] ?? 0
          next[item.id] = photos.length > 0 ? Math.min(current, photos.length - 1) : 0
        }
        return next
      })
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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

  function resetForm() {
    setForm({
      brand: '',
      model: '',
      year: '',
      engine_cc: '',
      color: '',
      description: '',
      photo_url: '',
      photos: [],
    })
    setEditingId(null)
  }

  function startCreate() {
    resetForm()
    setShowForm(true)
  }

  function startEdit(m: Motorcycle) {
    setEditingId(m.id)
    setForm({
      brand: m.brand,
      model: m.model,
      year: m.year ? String(m.year) : '',
      engine_cc: m.engine_cc ? String(m.engine_cc) : '',
      color: m.color ?? '',
      description: m.description ?? '',
      photo_url: m.photo_url ?? '',
      photos: getMotorcyclePhotos(m),
    })
    setShowForm(true)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.brand.trim() || !form.model.trim()) {
      setError('Марка и модель обязательны')
      return
    }
    setBusy(true)
    try {
      const payload = toPayload(form)
      if (editingId != null) {
        await apiUpdateMotorcycle(editingId, payload)
      } else {
        await apiCreateMotorcycle(payload)
      }
      setShowForm(false)
      resetForm()
      await load()
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm('Удалить этот мотоцикл?')) return
    setBusy(true)
    setError(null)
    try {
      await apiDeleteMotorcycle(id)
      await load()
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Загрузка фото в форме (для нового или редактируемого мотоцикла).
   *
   * При создании (editingId == null) файл сохраняется и мы просто получаем
   * URL — сам мотоцикл создастся при сабмите формы.
   */
  async function onFormPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setError(null)
    setPhotoUploading(true)
    try {
      const uploaded = await Promise.all(
        files.map((file) => apiUploadMotorcycleImage(file)),
      )
      setForm((f) => {
        const photos = Array.from(
          new Set([...f.photos, ...uploaded.map(({ url }) => url)]),
        )
        return { ...f, photo_url: photos[0] ?? '', photos }
      })
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setPhotoUploading(false)
    }
  }

  /** Загрузка/обновление фото прямо из карточки в списке. */
  async function onCardPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    const id = cardUploadingId
    if (!file || id == null) {
      setCardUploadingId(null)
      return
    }
    setError(null)
    try {
      await apiUploadMotorcyclePhoto(id, file)
      await load()
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setCardUploadingId(null)
    }
  }

  function triggerCardPhoto(id: number) {
    setCardUploadingId(id)
    // Даём React обновить state, затем открываем диалог
    setTimeout(() => cardPhotoInputRef.current?.click(), 0)
  }

  async function onRemoveCardPhoto(m: Motorcycle) {
    const photos = getMotorcyclePhotos(m)
    if (photos.length === 0) return
    if (!window.confirm('Удалить все фото мотоцикла?')) return
    setError(null)
    try {
      await apiUpdateMotorcycle(m.id, { photo_url: null, photos: [] })
      await load()
    } catch (err) {
      setError(extractApiError(err))
    }
  }

  async function onRemoveSingleCardPhoto(m: Motorcycle, url: string) {
    const photos = getMotorcyclePhotos(m)
    if (!photos.includes(url)) return
    if (!window.confirm('Удалить это фото мотоцикла?')) return
    setError(null)
    setBusy(true)
    try {
      const nextPhotos = photos.filter((item) => item !== url)
      await apiUpdateMotorcycle(m.id, {
        photo_url: nextPhotos[0] ?? null,
        photos: nextPhotos,
      })
      await load()
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  function removeFormPhoto(url: string) {
    setForm((f) => {
      const photos = f.photos.filter((item) => item !== url)
      return {
        ...f,
        photo_url: photos[0] ?? '',
        photos,
      }
    })
  }

  function showPrevPhoto(motoId: number, count: number) {
    if (count <= 1) return
    setPhotoIndexes((prev) => {
      const current = prev[motoId] ?? 0
      return {
        ...prev,
        [motoId]: (current - 1 + count) % count,
      }
    })
  }

  function showNextPhoto(motoId: number, count: number) {
    if (count <= 1) return
    setPhotoIndexes((prev) => {
      const current = prev[motoId] ?? 0
      return {
        ...prev,
        [motoId]: (current + 1) % count,
      }
    })
  }

  function setActivePhoto(motoId: number, index: number) {
    setPhotoIndexes((prev) => ({
      ...prev,
      [motoId]: index,
    }))
  }

  function openLightbox(motoId: number, photos: string[], index: number, title: string) {
    if (photos.length === 0) return
    setLightbox({ motoId, photos, index, title })
  }

  function showPrevLightboxPhoto() {
    setLightbox((prev) => {
      if (!prev || prev.photos.length <= 1) return prev
      return {
        ...prev,
        index: (prev.index - 1 + prev.photos.length) % prev.photos.length,
      }
    })
  }

  function showNextLightboxPhoto() {
    setLightbox((prev) => {
      if (!prev || prev.photos.length <= 1) return prev
      return {
        ...prev,
        index: (prev.index + 1) % prev.photos.length,
      }
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
    <section className="garage">
      <header className="garage__head">
        <div>
          <h1 className="garage__title">🏍️ Мой гараж</h1>
          <p className="muted">Мотоциклы, на которых ты рассекаешь по асфальту</p>
        </div>
        {!showForm && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={startCreate}
          >
            + Добавить
          </button>
        )}
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <div className="edit-card">
          <h2 className="garage__form-title">
            {editingId != null ? 'Редактировать мотоцикл' : 'Новый мотоцикл'}
          </h2>
          <form className="form" onSubmit={onSubmit} noValidate>
            <div className="grid-2">
              <label className="field">
                <span>Марка *</span>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={form.brand}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, brand: e.target.value }))
                  }
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>Модель *</span>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={form.model}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, model: e.target.value }))
                  }
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>Год</span>
                <input
                  type="number"
                  min={1885}
                  max={2100}
                  value={form.year}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, year: e.target.value }))
                  }
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>Объём двигателя (cc)</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  step="any"
                  value={form.engine_cc}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, engine_cc: e.target.value }))
                  }
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>Цвет</span>
                <input
                  type="text"
                  maxLength={64}
                  value={form.color}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, color: e.target.value }))
                  }
                  disabled={busy}
                />
              </label>
            </div>
            <label className="field">
              <span>Описание</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                disabled={busy}
              />
            </label>

            <div className="field">
              <span>Фотографии</span>
              <div className="photo-picker">
                {form.photos.length > 0 ? (
                  <div className="gallery-edit">
                    {form.photos.map((url) => (
                      <div key={url} className="gallery-edit__item">
                        <img src={url} alt="Фото мотоцикла" loading="lazy" />
                        <button
                          type="button"
                          className="gallery-edit__remove"
                          onClick={() => removeFormPhoto(url)}
                          disabled={busy || photoUploading}
                          aria-label="Удалить фото"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="photo-picker__placeholder">🏍️</div>
                )}
                <div className="photo-picker__actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => formPhotoInputRef.current?.click()}
                    disabled={busy || photoUploading}
                  >
                    {photoUploading
                      ? 'Загрузка…'
                      : form.photos.length > 0
                        ? '📷 Добавить ещё фото'
                        : '📷 Загрузить фото'}
                  </button>
                  {form.photos.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() =>
                        setForm((f) => ({ ...f, photo_url: '', photos: [] }))
                      }
                      disabled={busy || photoUploading}
                    >
                      Убрать все
                    </button>
                  )}
                  <input
                    ref={formPhotoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    multiple
                    onChange={onFormPhotoChange}
                    style={{ display: 'none' }}
                  />
                </div>
              </div>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy}
              >
                {busy
                  ? 'Сохраняем…'
                  : editingId != null
                    ? 'Сохранить'
                    : 'Добавить'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setShowForm(false)
                  resetForm()
                }}
                disabled={busy}
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Один скрытый input для загрузки фото прямо из карточек списка */}
      <input
        ref={cardPhotoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={onCardPhotoChange}
        style={{ display: 'none' }}
      />

      {loading ? (
        <div className="muted">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">🏍️</div>
          <p className="muted">Гараж пуст. Добавь свой первый мотоцикл.</p>
        </div>
      ) : (
        <div className="moto-list">
          {items.map((m) => {
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
                    onClick={() =>
                      openLightbox(m.id, photos, activeIndex, `${m.brand} ${m.model}`)
                    }
                    onTouchStart={handlePhotoTouchStart}
                    onTouchEnd={(e) => handlePhotoTouchEnd(e, m.id, photos.length)}
                    aria-label={`Открыть фото мотоцикла ${m.brand} ${m.model}`}
                  >
                    <img src={coverPhoto} alt={`${m.brand} ${m.model}`} />
                  </button>
                  {photos.length > 1 && (
                    <>
                      <button
                        type="button"
                        className="moto-card__nav moto-card__nav--prev"
                        onClick={(e) => {
                          e.stopPropagation()
                          showPrevPhoto(m.id, photos.length)
                        }}
                        aria-label="Предыдущее фото"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="moto-card__nav moto-card__nav--next"
                        onClick={(e) => {
                          e.stopPropagation()
                          showNextPhoto(m.id, photos.length)
                        }}
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
                      <button
                        type="button"
                        className="moto-card__thumb-remove"
                        onClick={() => onRemoveSingleCardPhoto(m, url)}
                        disabled={busy}
                        aria-label={`Удалить фото ${index + 1}`}
                        title="Удалить фото"
                      >
                        ×
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
                  <p className="muted">Фото в галерее: {photos.length}</p>
                )}
              </div>
              <div className="moto-card__actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => triggerCardPhoto(m.id)}
                  disabled={busy || cardUploadingId != null}
                >
                  {cardUploadingId === m.id
                    ? 'Загрузка…'
                    : photos.length > 0
                      ? '📷 Добавить фото'
                      : '📷 Фото'}
                </button>
                {photos.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => onRemoveCardPhoto(m)}
                    disabled={busy}
                  >
                    Убрать все фото
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => startEdit(m)}
                  disabled={busy}
                >
                  Изменить
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => onDelete(m.id)}
                  disabled={busy}
                >
                  Удалить
                </button>
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
