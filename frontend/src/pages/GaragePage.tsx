import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
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
}): MotorcyclePayload {
  return {
    brand: form.brand.trim(),
    model: form.model.trim(),
    year: form.year ? Number(form.year) : null,
    engine_cc: form.engine_cc ? Number(form.engine_cc) : null,
    color: form.color.trim() || null,
    description: form.description.trim() || null,
    photo_url: form.photo_url.trim() || null,
  }
}

export default function GaragePage() {
  const [items, setItems] = useState<Motorcycle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
  })

  const formPhotoInputRef = useRef<HTMLInputElement>(null)
  // Для загрузки фото прямо в карточке (у уже сохранённого мотоцикла).
  // Один hidden-input используется для активного id.
  const cardPhotoInputRef = useRef<HTMLInputElement>(null)
  const [cardUploadingId, setCardUploadingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiListMyMotorcycles()
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

  function resetForm() {
    setForm({
      brand: '',
      model: '',
      year: '',
      engine_cc: '',
      color: '',
      description: '',
      photo_url: '',
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
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setPhotoUploading(true)
    try {
      const { url } = await apiUploadMotorcycleImage(file)
      setForm((f) => ({ ...f, photo_url: url }))
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
    if (!m.photo_url) return
    if (!window.confirm('Удалить фото мотоцикла?')) return
    setError(null)
    try {
      await apiUpdateMotorcycle(m.id, { photo_url: null })
      await load()
    } catch (err) {
      setError(extractApiError(err))
    }
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
              <span>Фото мотоцикла</span>
              <div className="photo-picker">
                {form.photo_url ? (
                  <div className="photo-picker__preview">
                    <img src={form.photo_url} alt="фото мотоцикла" />
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
                      : form.photo_url
                        ? 'Сменить фото'
                        : '📷 Загрузить фото'}
                  </button>
                  {form.photo_url && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() =>
                        setForm((f) => ({ ...f, photo_url: '' }))
                      }
                      disabled={busy || photoUploading}
                    >
                      Убрать
                    </button>
                  )}
                  <input
                    ref={formPhotoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
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
          {items.map((m) => (
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
              <div className="moto-card__actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => triggerCardPhoto(m.id)}
                  disabled={busy || cardUploadingId != null}
                >
                  {cardUploadingId === m.id
                    ? 'Загрузка…'
                    : m.photo_url
                      ? '📷 Сменить фото'
                      : '📷 Фото'}
                </button>
                {m.photo_url && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => onRemoveCardPhoto(m)}
                    disabled={busy}
                  >
                    Убрать фото
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
          ))}
        </div>
      )}
    </section>
  )
}
