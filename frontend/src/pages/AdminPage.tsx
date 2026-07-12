import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { extractApiError } from '../api/client'
import {
  apiCreateEvent,
  apiDeleteEvent,
  apiListEvents,
  apiUpdateEvent,
  type EventItem,
  type EventPayload,
} from '../api/events'
import {
  apiAdminListUsers,
  apiAdminSetActive,
  apiAdminSetSuperuser,
} from '../api/admin'
import type { User } from '../api/auth'
import { useAuth } from '../context/AuthContext'

type Tab = 'events' | 'users'

const EMPTY_FORM = {
  event_date: '',
  title: '',
  organizer: '',
  location: '',
  description: '',
}

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth()

  const [tab, setTab] = useState<Tab>('events')

  // events
  const [events, setEvents] = useState<EventItem[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [busy, setBusy] = useState(false)

  // users
  const [users, setUsers] = useState<User[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)

  const loadEvents = useCallback(async () => {
    setEventsLoading(true)
    setEventsError(null)
    try {
      setEvents(await apiListEvents())
    } catch (err) {
      setEventsError(extractApiError(err))
    } finally {
      setEventsLoading(false)
    }
  }, [])

  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    setUsersError(null)
    try {
      setUsers(await apiAdminListUsers())
    } catch (err) {
      setUsersError(extractApiError(err))
    } finally {
      setUsersLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user?.is_superuser) return
    if (tab === 'events') void loadEvents()
    else void loadUsers()
  }, [tab, user, loadEvents, loadUsers])

  if (authLoading) return null
  if (!user) return <Navigate to="/login" replace />
  if (!user.is_superuser) {
    return (
      <section className="admin-page">
        <div className="empty-state">
          <div className="empty-state__icon">🔒</div>
          <p className="muted">
            Раздел доступен только администраторам.
          </p>
          <Link to="/" className="btn btn-ghost">
            На главную
          </Link>
        </div>
      </section>
    )
  }

  function resetForm() {
    setForm({ ...EMPTY_FORM })
    setEditingId(null)
  }

  function startCreate() {
    resetForm()
    setShowForm(true)
  }

  function startEdit(e: EventItem) {
    setEditingId(e.id)
    setForm({
      event_date: e.event_date,
      title: e.title,
      organizer: e.organizer,
      location: e.location,
      description: e.description ?? '',
    })
    setShowForm(true)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setEventsError(null)
    if (
      !form.event_date ||
      !form.title.trim() ||
      !form.organizer.trim() ||
      !form.location.trim()
    ) {
      setEventsError('Дата, название, организатор и место обязательны')
      return
    }
    setBusy(true)
    try {
      const payload: EventPayload = {
        event_date: form.event_date,
        title: form.title.trim(),
        organizer: form.organizer.trim(),
        location: form.location.trim(),
        description: form.description.trim() || null,
      }
      if (editingId != null) {
        await apiUpdateEvent(editingId, payload)
      } else {
        await apiCreateEvent(payload)
      }
      setShowForm(false)
      resetForm()
      await loadEvents()
    } catch (err) {
      setEventsError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm('Удалить это мероприятие?')) return
    setBusy(true)
    setEventsError(null)
    try {
      await apiDeleteEvent(id)
      await loadEvents()
    } catch (err) {
      setEventsError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onToggleAdmin(u: User) {
    setUsersError(null)
    try {
      const updated = await apiAdminSetSuperuser(u.id, !u.is_superuser)
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)))
    } catch (err) {
      setUsersError(extractApiError(err))
    }
  }

  async function onToggleActive(u: User) {
    setUsersError(null)
    try {
      const updated = await apiAdminSetActive(u.id, !u.is_active)
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)))
    } catch (err) {
      setUsersError(extractApiError(err))
    }
  }

  return (
    <section className="admin-page">
      <header className="admin-page__head">
        <div>
          <h1 className="admin-page__title">⚙ Админка</h1>
          <p className="muted">Управление мотокалендарём и пользователями</p>
        </div>
      </header>

      <div className="admin-tabs">
        <button
          type="button"
          className={`admin-tab ${tab === 'events' ? 'is-active' : ''}`}
          onClick={() => setTab('events')}
        >
          📅 Мероприятия
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === 'users' ? 'is-active' : ''}`}
          onClick={() => setTab('users')}
        >
          👥 Пользователи
        </button>
      </div>

      {tab === 'events' && (
        <div className="admin-section">
          <div className="admin-section__head">
            <h2 className="admin-section__title">Мероприятия</h2>
            {!showForm && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={startCreate}
              >
                + Добавить
              </button>
            )}
          </div>

          {eventsError && (
            <div className="alert alert-error">{eventsError}</div>
          )}

          {showForm && (
            <div className="edit-card">
              <h3 className="garage__form-title">
                {editingId != null
                  ? 'Редактировать мероприятие'
                  : 'Новое мероприятие'}
              </h3>
              <form className="form" onSubmit={onSubmit} noValidate>
                <div className="grid-2">
                  <label className="field">
                    <span>Дата *</span>
                    <input
                      type="date"
                      required
                      value={form.event_date}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, event_date: e.target.value }))
                      }
                      disabled={busy}
                    />
                  </label>
                  <label className="field">
                    <span>Название *</span>
                    <input
                      type="text"
                      required
                      maxLength={255}
                      value={form.title}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, title: e.target.value }))
                      }
                      disabled={busy}
                    />
                  </label>
                  <label className="field">
                    <span>Организатор *</span>
                    <input
                      type="text"
                      required
                      maxLength={255}
                      value={form.organizer}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, organizer: e.target.value }))
                      }
                      disabled={busy}
                    />
                  </label>
                  <label className="field">
                    <span>Место *</span>
                    <input
                      type="text"
                      required
                      maxLength={255}
                      value={form.location}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, location: e.target.value }))
                      }
                      disabled={busy}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Описание</span>
                  <textarea
                    rows={3}
                    maxLength={4000}
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

          {eventsLoading ? (
            <div className="muted">Загрузка…</div>
          ) : events.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">📅</div>
              <p className="muted">Ни одного мероприятия ещё не добавлено.</p>
            </div>
          ) : (
            <div className="events-table-wrap">
              <table className="events-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Название</th>
                    <th>Организатор</th>
                    <th>Место</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="events-table__date">{e.event_date}</td>
                      <td>
                        <div className="events-table__title">{e.title}</div>
                        {e.description && (
                          <div className="events-table__desc">
                            {e.description}
                          </div>
                        )}
                      </td>
                      <td>{e.organizer}</td>
                      <td>{e.location}</td>
                      <td className="events-table__actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => startEdit(e)}
                          disabled={busy}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() => onDelete(e.id)}
                          disabled={busy}
                        >
                          Удалить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'users' && (
        <div className="admin-section">
          <div className="admin-section__head">
            <h2 className="admin-section__title">Пользователи</h2>
          </div>

          {usersError && <div className="alert alert-error">{usersError}</div>}

          {usersLoading ? (
            <div className="muted">Загрузка…</div>
          ) : (
            <div className="events-table-wrap">
              <table className="events-table">
                <thead>
                  <tr>
                    <th>Логин</th>
                    <th>Email</th>
                    <th>Имя</th>
                    <th>Админ</th>
                    <th>Активен</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className={u.is_active ? '' : 'is-past'}>
                      <td>
                        <strong>@{u.username}</strong>
                        {u.id === user.id && (
                          <span className="tag-me"> ты</span>
                        )}
                      </td>
                      <td>{u.email}</td>
                      <td>{u.full_name || '—'}</td>
                      <td>
                        {u.is_superuser ? (
                          <span className="badge badge-accent">админ</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {u.is_active ? (
                          <span className="badge">активен</span>
                        ) : (
                          <span className="badge badge-danger">
                            заблокирован
                          </span>
                        )}
                      </td>
                      <td className="events-table__actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onToggleAdmin(u)}
                          disabled={u.id === user.id && u.is_superuser}
                          title={
                            u.id === user.id && u.is_superuser
                              ? 'Нельзя снять права с себя'
                              : ''
                          }
                        >
                          {u.is_superuser ? 'Снять админа' : 'Сделать админом'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() => onToggleActive(u)}
                          disabled={u.id === user.id && u.is_active}
                          title={
                            u.id === user.id && u.is_active
                              ? 'Нельзя заблокировать себя'
                              : ''
                          }
                        >
                          {u.is_active ? 'Заблокировать' : 'Разблокировать'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
