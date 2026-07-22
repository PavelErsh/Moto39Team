import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { extractApiError } from '../api/client'
import {
  apiCreateMotorcycle,
  apiDeleteMotorcycle,
  apiListMyMotorcycles,
  apiUpdateMotorcycle,
  type Motorcycle,
  type MotorcyclePayload,
} from '../api/motorcycles'

const EMPTY_FORM: MotorcyclePayload = {
  brand: '',
  model: '',
  year: null,
  engine_cc: null,
  color: '',
  description: '',
}

function toPayload(form: {
  brand: string
  model: string
  year: string
  engine_cc: string
  color: string
  description: string
}): MotorcyclePayload {
  return {
    brand: form.brand.trim(),
    model: form.model.trim(),
    year: form.year ? Number(form.year) : null,
    engine_cc: form.engine_cc ? Number(form.engine_cc) : null,
    color: form.color.trim() || null,
    description: form.description.trim() || null,
  }
}

export default function GaragePage() {
  const [items, setItems] = useState<Motorcycle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [form, setForm] = useState({
    brand: '',
    model: '',
    year: '',
    engine_cc: '',
    color: '',
    description: '',
  })

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
        void EMPTY_FORM
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
