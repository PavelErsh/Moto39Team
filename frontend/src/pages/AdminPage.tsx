import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { Link, Navigate } from 'react-router-dom'
import { extractApiError } from '../api/client'
import {
  apiCreateEvent,
  apiDeleteEvent,
  apiListEvents,
  apiUpdateEvent,
  apiUploadEventImage,
  type EventItem,
  type EventPayload,
} from '../api/events'
import {
  apiCreateRide,
  apiDeleteRide,
  apiListRides,
  apiUpdateRide,
  apiUploadRideImage,
  type RideItem,
  type RidePayload,
} from '../api/rides'
import {
  apiAdminListUsers,
  apiAdminSetActive,
  apiAdminSetSuperuser,
} from '../api/admin'
import {
  apiCreateReference,
  apiDeleteReference,
  apiListReferences,
  apiUpdateReference,
  apiUploadReferenceImage,
  type ReferenceItem,
  type ReferencePayload,
} from '../api/references'
import type { User } from '../api/auth'
import { useAuth } from '../context/AuthContext'

type Tab = 'events' | 'rides' | 'users' | 'references'

const EMPTY_EVENT_FORM = {
  event_date: '',
  end_date: '',
  title: '',
  organizer: '',
  location: '',
  description: '',
  cover_image_url: '',
  images: [] as string[],
}

const EMPTY_REF_FORM = {
  slug: '',
  title: '',
  category: '',
  summary: '',
  content: '',
  cover_image_url: '',
  images: [] as string[],
}

function slugify(s: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
    з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
    ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
    я: 'ya',
  }
  return s
    .toLowerCase()
    .split('')
    .map((ch) => (map[ch] !== undefined ? map[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160)
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
  const [form, setForm] = useState({ ...EMPTY_EVENT_FORM })
  const [busy, setBusy] = useState(false)

  // users
  const [users, setUsers] = useState<User[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [usersView, setUsersView] = useState<'active' | 'blocked'>('active')

  // references
  const [refs, setRefs] = useState<ReferenceItem[]>([])
  const [refsLoading, setRefsLoading] = useState(false)
  const [refsError, setRefsError] = useState<string | null>(null)
  const [refEditingId, setRefEditingId] = useState<number | null>(null)
  const [showRefForm, setShowRefForm] = useState(false)
  const [refForm, setRefForm] = useState({ ...EMPTY_REF_FORM })
  const [refSlugTouched, setRefSlugTouched] = useState(false)
  const [refBusy, setRefBusy] = useState(false)
  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const eventCoverInputRef = useRef<HTMLInputElement | null>(null)
  const eventGalleryInputRef = useRef<HTMLInputElement | null>(null)

  // rides
  const [rides, setRides] = useState<RideItem[]>([])
  const [ridesLoading, setRidesLoading] = useState(false)
  const [ridesError, setRidesError] = useState<string | null>(null)
  const [rideEditingId, setRideEditingId] = useState<number | null>(null)
  const [showRideForm, setShowRideForm] = useState(false)
  const [rideForm, setRideForm] = useState({ ...EMPTY_EVENT_FORM })
  const [rideBusy, setRideBusy] = useState(false)
  const rideCoverInputRef = useRef<HTMLInputElement | null>(null)
  const rideGalleryInputRef = useRef<HTMLInputElement | null>(null)

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

  const loadRefs = useCallback(async () => {
    setRefsLoading(true)
    setRefsError(null)
    try {
      setRefs(await apiListReferences())
    } catch (err) {
      setRefsError(extractApiError(err))
    } finally {
      setRefsLoading(false)
    }
  }, [])

  const loadRides = useCallback(async () => {
    setRidesLoading(true)
    setRidesError(null)
    try {
      setRides(await apiListRides())
    } catch (err) {
      setRidesError(extractApiError(err))
    } finally {
      setRidesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user?.is_superuser) return
    if (tab === 'events') void loadEvents()
    else if (tab === 'rides') void loadRides()
    else if (tab === 'users') void loadUsers()
    else if (tab === 'references') void loadRefs()
  }, [tab, user, loadEvents, loadRides, loadUsers, loadRefs])

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
    setForm({ ...EMPTY_EVENT_FORM })
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
      end_date: e.end_date ?? '',
      title: e.title,
      organizer: e.organizer,
      location: e.location,
      description: e.description ?? '',
      cover_image_url: e.cover_image_url ?? '',
      images: [...e.images],
    })
    setShowForm(true)
  }

  async function onEventCoverPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setEventsError(null)
    try {
      const { url } = await apiUploadEventImage(file)
      setForm((f) => ({ ...f, cover_image_url: url }))
    } catch (err) {
      setEventsError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onEventGalleryPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setBusy(true)
    setEventsError(null)
    try {
      const uploaded: string[] = []
      for (const f of files) {
        const { url } = await apiUploadEventImage(f)
        uploaded.push(url)
      }
      setForm((f) => ({ ...f, images: [...f.images, ...uploaded] }))
    } catch (err) {
      setEventsError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  function removeEventGalleryImage(url: string) {
    setForm((f) => ({
      ...f,
      images: f.images.filter((u) => u !== url),
    }))
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
    if (form.end_date && form.end_date < form.event_date) {
      setEventsError('Дата окончания не может быть раньше даты начала')
      return
    }
    setBusy(true)
    try {
      // Если дата окончания не указана либо совпадает с датой начала —
      // отправляем null (событие однодневное).
      const endDate =
        form.end_date && form.end_date !== form.event_date
          ? form.end_date
          : null
      const payload: EventPayload = {
        event_date: form.event_date,
        end_date: endDate,
        title: form.title.trim(),
        organizer: form.organizer.trim(),
        location: form.location.trim(),
        description: form.description.trim() || null,
        cover_image_url: form.cover_image_url.trim() || null,
        images: form.images,
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

  // ---------------------- RIDES ----------------------

  function resetRideForm() {
    setRideForm({ ...EMPTY_EVENT_FORM })
    setRideEditingId(null)
  }

  function startRideCreate() {
    resetRideForm()
    setShowRideForm(true)
  }

  function startRideEdit(r: RideItem) {
    setRideEditingId(r.id)
    setRideForm({
      event_date: r.event_date,
      end_date: r.end_date ?? '',
      title: r.title,
      organizer: r.organizer,
      location: r.location,
      description: r.description ?? '',
      cover_image_url: r.cover_image_url ?? '',
      images: [...r.images],
    })
    setShowRideForm(true)
  }

  async function onRideCoverPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setRideBusy(true)
    setRidesError(null)
    try {
      const { url } = await apiUploadRideImage(file)
      setRideForm((f) => ({ ...f, cover_image_url: url }))
    } catch (err) {
      setRidesError(extractApiError(err))
    } finally {
      setRideBusy(false)
    }
  }

  async function onRideGalleryPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setRideBusy(true)
    setRidesError(null)
    try {
      const uploaded: string[] = []
      for (const f of files) {
        const { url } = await apiUploadRideImage(f)
        uploaded.push(url)
      }
      setRideForm((f) => ({ ...f, images: [...f.images, ...uploaded] }))
    } catch (err) {
      setRidesError(extractApiError(err))
    } finally {
      setRideBusy(false)
    }
  }

  function removeRideGalleryImage(url: string) {
    setRideForm((f) => ({
      ...f,
      images: f.images.filter((u) => u !== url),
    }))
  }

  async function onRideSubmit(e: FormEvent) {
    e.preventDefault()
    setRidesError(null)
    if (
      !rideForm.event_date ||
      !rideForm.title.trim() ||
      !rideForm.organizer.trim() ||
      !rideForm.location.trim()
    ) {
      setRidesError('Дата, название, организатор и место обязательны')
      return
    }
    if (rideForm.end_date && rideForm.end_date < rideForm.event_date) {
      setRidesError('Дата окончания не может быть раньше даты начала')
      return
    }
    setRideBusy(true)
    try {
      const endDate =
        rideForm.end_date && rideForm.end_date !== rideForm.event_date
          ? rideForm.end_date
          : null
      const payload: RidePayload = {
        event_date: rideForm.event_date,
        end_date: endDate,
        title: rideForm.title.trim(),
        organizer: rideForm.organizer.trim(),
        location: rideForm.location.trim(),
        description: rideForm.description.trim() || null,
        cover_image_url: rideForm.cover_image_url.trim() || null,
        images: rideForm.images,
      }
      if (rideEditingId != null) {
        await apiUpdateRide(rideEditingId, payload)
      } else {
        await apiCreateRide(payload)
      }
      setShowRideForm(false)
      resetRideForm()
      await loadRides()
    } catch (err) {
      setRidesError(extractApiError(err))
    } finally {
      setRideBusy(false)
    }
  }

  async function onRideDelete(id: number) {
    if (!window.confirm('Удалить это событие?')) return
    setRideBusy(true)
    setRidesError(null)
    try {
      await apiDeleteRide(id)
      await loadRides()
    } catch (err) {
      setRidesError(extractApiError(err))
    } finally {
      setRideBusy(false)
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

  // ---------------------- REFERENCES ----------------------

  function resetRefForm() {
    setRefForm({ ...EMPTY_REF_FORM })
    setRefEditingId(null)
    setRefSlugTouched(false)
  }

  function startRefCreate() {
    resetRefForm()
    setShowRefForm(true)
  }

  function startRefEdit(r: ReferenceItem) {
    setRefEditingId(r.id)
    setRefForm({
      slug: r.slug,
      title: r.title,
      category: r.category ?? '',
      summary: r.summary ?? '',
      content: r.content ?? '',
      cover_image_url: r.cover_image_url ?? '',
      images: [...r.images],
    })
    setRefSlugTouched(true)
    setShowRefForm(true)
  }

  function onRefTitleChange(value: string) {
    setRefForm((f) => ({
      ...f,
      title: value,
      slug: refSlugTouched ? f.slug : slugify(value),
    }))
  }

  function onRefSlugChange(value: string) {
    setRefSlugTouched(true)
    setRefForm((f) => ({ ...f, slug: value }))
  }

  async function onRefSubmit(e: FormEvent) {
    e.preventDefault()
    setRefsError(null)
    const slug = refForm.slug.trim()
    if (!refForm.title.trim() || !slug) {
      setRefsError('Название и slug обязательны')
      return
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setRefsError('Slug может содержать только латиницу, цифры и дефис')
      return
    }
    setRefBusy(true)
    try {
      const payload: ReferencePayload = {
        slug,
        title: refForm.title.trim(),
        category: refForm.category.trim() || null,
        summary: refForm.summary.trim() || null,
        content: refForm.content,
        cover_image_url: refForm.cover_image_url.trim() || null,
        images: refForm.images,
      }
      if (refEditingId != null) {
        await apiUpdateReference(refEditingId, payload)
      } else {
        await apiCreateReference(payload)
      }
      setShowRefForm(false)
      resetRefForm()
      await loadRefs()
    } catch (err) {
      setRefsError(extractApiError(err))
    } finally {
      setRefBusy(false)
    }
  }

  async function onRefDelete(id: number) {
    if (!window.confirm('Удалить эту статью?')) return
    setRefBusy(true)
    setRefsError(null)
    try {
      await apiDeleteReference(id)
      await loadRefs()
    } catch (err) {
      setRefsError(extractApiError(err))
    } finally {
      setRefBusy(false)
    }
  }

  async function onCoverPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setRefBusy(true)
    setRefsError(null)
    try {
      const { url } = await apiUploadReferenceImage(file)
      setRefForm((f) => ({ ...f, cover_image_url: url }))
    } catch (err) {
      setRefsError(extractApiError(err))
    } finally {
      setRefBusy(false)
    }
  }

  async function onGalleryPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setRefBusy(true)
    setRefsError(null)
    try {
      const uploaded: string[] = []
      for (const f of files) {
        const { url } = await apiUploadReferenceImage(f)
        uploaded.push(url)
      }
      setRefForm((f) => ({ ...f, images: [...f.images, ...uploaded] }))
    } catch (err) {
      setRefsError(extractApiError(err))
    } finally {
      setRefBusy(false)
    }
  }

  function removeGalleryImage(url: string) {
    setRefForm((f) => ({
      ...f,
      images: f.images.filter((u) => u !== url),
    }))
  }

  return (
    <section className="admin-page">
      <header className="admin-page__head">
        <div>
          <h1 className="admin-page__title">⚙️ Админка</h1>
          <p className="muted">
            Управление мероприятиями, событиями, мотосправкой и пользователями
          </p>
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
          className={`admin-tab ${tab === 'rides' ? 'is-active' : ''}`}
          onClick={() => setTab('rides')}
        >
          🎉 События
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === 'references' ? 'is-active' : ''}`}
          onClick={() => setTab('references')}
        >
          📖 Мотосправка
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
                    <span>Дата начала *</span>
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
                    <span>
                      Дата окончания{' '}
                      <small className="muted">
                        (для многодневных)
                      </small>
                    </span>
                    <input
                      type="date"
                      value={form.end_date}
                      min={form.event_date || undefined}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, end_date: e.target.value }))
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
                  <label className="field">
                    <span>Обложка (URL или загрузка)</span>
                    <input
                      type="text"
                      maxLength={500}
                      placeholder="/media/events/…"
                      value={form.cover_image_url}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          cover_image_url: e.target.value,
                        }))
                      }
                      disabled={busy}
                    />
                    <div className="cover-actions">
                      <input
                        type="file"
                        accept="image/*"
                        ref={eventCoverInputRef}
                        onChange={onEventCoverPick}
                        hidden
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => eventCoverInputRef.current?.click()}
                        disabled={busy}
                      >
                        Загрузить обложку…
                      </button>
                      {form.cover_image_url && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() =>
                            setForm((f) => ({ ...f, cover_image_url: '' }))
                          }
                          disabled={busy}
                        >
                          Убрать
                        </button>
                      )}
                    </div>
                    {form.cover_image_url && (
                      <div className="cover-preview">
                        <img src={form.cover_image_url} alt="обложка" />
                      </div>
                    )}
                  </label>
                </div>
                <label className="field">
                  <span>Описание / текст мероприятия</span>
                  <textarea
                    rows={10}
                    maxLength={50000}
                    value={form.description}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, description: e.target.value }))
                    }
                    disabled={busy}
                    placeholder="Подробности, программа, условия участия… Абзацы разделяйте пустой строкой."
                  />
                </label>

                <div className="field">
                  <span>Прикреплённые изображения</span>
                  <div className="cover-actions">
                    <input
                      type="file"
                      accept="image/*"
                      ref={eventGalleryInputRef}
                      onChange={onEventGalleryPick}
                      multiple
                      hidden
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => eventGalleryInputRef.current?.click()}
                      disabled={busy}
                    >
                      Добавить изображения…
                    </button>
                    <small className="muted">
                      JPG / PNG / WEBP / GIF, до 16 МБ
                    </small>
                  </div>
                  {form.images.length > 0 && (
                    <div className="gallery-edit">
                      {form.images.map((url) => (
                        <div key={url} className="gallery-edit__item">
                          <img src={url} alt="" loading="lazy" />
                          <button
                            type="button"
                            className="gallery-edit__remove"
                            onClick={() => removeEventGalleryImage(url)}
                            disabled={busy}
                            aria-label="Удалить изображение"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
                    <th>Обложка</th>
                    <th>Название</th>
                    <th>Организатор</th>
                    <th>Место</th>
                    <th>Изобр.</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="events-table__date">
                        {e.end_date && e.end_date !== e.event_date
                          ? `${e.event_date} — ${e.end_date}`
                          : e.event_date}
                      </td>
                      <td>
                        {e.cover_image_url ? (
                          <div className="events-table__cover">
                            <img
                              src={e.cover_image_url}
                              alt=""
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="events-table__title">{e.title}</div>
                        {e.description && (
                          <div className="events-table__desc">
                            {e.description}
                          </div>
                        )}
                        {e.images.length > 0 && (
                          <div className="events-table__thumbs">
                            {e.images.slice(0, 6).map((url) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="events-table__thumb"
                              >
                                <img src={url} alt="" loading="lazy" />
                              </a>
                            ))}
                            {e.images.length > 6 && (
                              <span className="events-table__thumb-more">
                                +{e.images.length - 6}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>{e.organizer}</td>
                      <td>{e.location}</td>
                      <td>{e.images.length + (e.cover_image_url ? 1 : 0)}</td>
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

      {tab === 'rides' && (
        <div className="admin-section">
          <div className="admin-section__head">
            <h2 className="admin-section__title">События</h2>
            {!showRideForm && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={startRideCreate}
              >
                + Добавить
              </button>
            )}
          </div>

          {ridesError && (
            <div className="alert alert-error">{ridesError}</div>
          )}

          {showRideForm && (
            <div className="edit-card">
              <h3 className="garage__form-title">
                {rideEditingId != null
                  ? 'Редактировать событие'
                  : 'Новое событие'}
              </h3>
              <form className="form" onSubmit={onRideSubmit} noValidate>
                <div className="grid-2">
                  <label className="field">
                    <span>Дата начала *</span>
                    <input
                      type="date"
                      required
                      value={rideForm.event_date}
                      onChange={(e) =>
                        setRideForm((f) => ({ ...f, event_date: e.target.value }))
                      }
                      disabled={rideBusy}
                    />
                  </label>
                  <label className="field">
                    <span>
                      Дата окончания{' '}
                      <small className="muted">(для многодневных)</small>
                    </span>
                    <input
                      type="date"
                      value={rideForm.end_date}
                      min={rideForm.event_date || undefined}
                      onChange={(e) =>
                        setRideForm((f) => ({ ...f, end_date: e.target.value }))
                      }
                      disabled={rideBusy}
                    />
                  </label>
                  <label className="field">
                    <span>Название *</span>
                    <input
                      type="text"
                      required
                      maxLength={255}
                      value={rideForm.title}
                      onChange={(e) =>
                        setRideForm((f) => ({ ...f, title: e.target.value }))
                      }
                      disabled={rideBusy}
                    />
                  </label>
                  <label className="field">
                    <span>Организатор *</span>
                    <input
                      type="text"
                      required
                      maxLength={255}
                      value={rideForm.organizer}
                      onChange={(e) =>
                        setRideForm((f) => ({ ...f, organizer: e.target.value }))
                      }
                      disabled={rideBusy}
                    />
                  </label>
                  <label className="field">
                    <span>Место *</span>
                    <input
                      type="text"
                      required
                      maxLength={255}
                      value={rideForm.location}
                      onChange={(e) =>
                        setRideForm((f) => ({ ...f, location: e.target.value }))
                      }
                      disabled={rideBusy}
                    />
                  </label>
                  <label className="field">
                    <span>Обложка (URL или загрузка)</span>
                    <input
                      type="text"
                      maxLength={500}
                      placeholder="/media/rides/…"
                      value={rideForm.cover_image_url}
                      onChange={(e) =>
                        setRideForm((f) => ({
                          ...f,
                          cover_image_url: e.target.value,
                        }))
                      }
                      disabled={rideBusy}
                    />
                    <div className="cover-actions">
                      <input
                        type="file"
                        accept="image/*"
                        ref={rideCoverInputRef}
                        onChange={onRideCoverPick}
                        hidden
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => rideCoverInputRef.current?.click()}
                        disabled={rideBusy}
                      >
                        Загрузить обложку…
                      </button>
                      {rideForm.cover_image_url && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() =>
                            setRideForm((f) => ({ ...f, cover_image_url: '' }))
                          }
                          disabled={rideBusy}
                        >
                          Убрать
                        </button>
                      )}
                    </div>
                    {rideForm.cover_image_url && (
                      <div className="cover-preview">
                        <img src={rideForm.cover_image_url} alt="обложка" />
                      </div>
                    )}
                  </label>
                </div>
                <label className="field">
                  <span>Описание / текст события</span>
                  <textarea
                    rows={10}
                    maxLength={50000}
                    value={rideForm.description}
                    onChange={(e) =>
                      setRideForm((f) => ({ ...f, description: e.target.value }))
                    }
                    disabled={rideBusy}
                    placeholder="Подробности, программа, условия участия… Абзацы разделяйте пустой строкой."
                  />
                </label>

                <div className="field">
                  <span>Прикреплённые изображения</span>
                  <div className="cover-actions">
                    <input
                      type="file"
                      accept="image/*"
                      ref={rideGalleryInputRef}
                      onChange={onRideGalleryPick}
                      multiple
                      hidden
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => rideGalleryInputRef.current?.click()}
                      disabled={rideBusy}
                    >
                      Добавить изображения…
                    </button>
                    <small className="muted">
                      JPG / PNG / WEBP / GIF, до 16 МБ
                    </small>
                  </div>
                  {rideForm.images.length > 0 && (
                    <div className="gallery-edit">
                      {rideForm.images.map((url) => (
                        <div key={url} className="gallery-edit__item">
                          <img src={url} alt="" loading="lazy" />
                          <button
                            type="button"
                            className="gallery-edit__remove"
                            onClick={() => removeRideGalleryImage(url)}
                            disabled={rideBusy}
                            aria-label="Удалить изображение"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="form-actions">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={rideBusy}
                  >
                    {rideBusy
                      ? 'Сохраняем…'
                      : rideEditingId != null
                        ? 'Сохранить'
                        : 'Добавить'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setShowRideForm(false)
                      resetRideForm()
                    }}
                    disabled={rideBusy}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            </div>
          )}

          {ridesLoading ? (
            <div className="muted">Загрузка…</div>
          ) : rides.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">🎉</div>
              <p className="muted">Ни одного события ещё не добавлено.</p>
            </div>
          ) : (
            <div className="events-table-wrap">
              <table className="events-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Обложка</th>
                    <th>Название</th>
                    <th>Организатор</th>
                    <th>Место</th>
                    <th>Изобр.</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rides.map((r) => (
                    <tr key={r.id}>
                      <td className="events-table__date">
                        {r.end_date && r.end_date !== r.event_date
                          ? `${r.event_date} — ${r.end_date}`
                          : r.event_date}
                      </td>
                      <td>
                        {r.cover_image_url ? (
                          <div className="events-table__cover">
                            <img
                              src={r.cover_image_url}
                              alt=""
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="events-table__title">{r.title}</div>
                        {r.description && (
                          <div className="events-table__desc">
                            {r.description}
                          </div>
                        )}
                        {r.images.length > 0 && (
                          <div className="events-table__thumbs">
                            {r.images.slice(0, 6).map((url) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="events-table__thumb"
                              >
                                <img src={url} alt="" loading="lazy" />
                              </a>
                            ))}
                            {r.images.length > 6 && (
                              <span className="events-table__thumb-more">
                                +{r.images.length - 6}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>{r.organizer}</td>
                      <td>{r.location}</td>
                      <td>{r.images.length + (r.cover_image_url ? 1 : 0)}</td>
                      <td className="events-table__actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => startRideEdit(r)}
                          disabled={rideBusy}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() => onRideDelete(r.id)}
                          disabled={rideBusy}
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

      {tab === 'references' && (
        <div className="admin-section">
          <div className="admin-section__head">
            <h2 className="admin-section__title">Мотосправка</h2>
            {!showRefForm && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={startRefCreate}
              >
                + Добавить статью
              </button>
            )}
          </div>

          {refsError && <div className="alert alert-error">{refsError}</div>}

          {showRefForm && (
            <div className="edit-card">
              <h3 className="garage__form-title">
                {refEditingId != null
                  ? 'Редактировать статью'
                  : 'Новая статья'}
              </h3>
              <form className="form" onSubmit={onRefSubmit} noValidate>
                <div className="grid-2">
                  <label className="field">
                    <span>Название *</span>
                    <input
                      type="text"
                      required
                      maxLength={255}
                      value={refForm.title}
                      onChange={(e) => onRefTitleChange(e.target.value)}
                      disabled={refBusy}
                    />
                  </label>
                  <label className="field">
                    <span>
                      Slug * <small className="muted">(URL, латиница)</small>
                    </span>
                    <input
                      type="text"
                      required
                      maxLength={160}
                      pattern="[a-z0-9\-]+"
                      value={refForm.slug}
                      onChange={(e) => onRefSlugChange(e.target.value)}
                      disabled={refBusy}
                    />
                  </label>
                  <label className="field">
                    <span>Категория</span>
                    <input
                      type="text"
                      maxLength={100}
                      placeholder="Техника, Право, Экипировка…"
                      value={refForm.category}
                      onChange={(e) =>
                        setRefForm((f) => ({
                          ...f,
                          category: e.target.value,
                        }))
                      }
                      disabled={refBusy}
                    />
                  </label>
                  <label className="field">
                    <span>Обложка (URL или загрузка)</span>
                    <input
                      type="text"
                      maxLength={500}
                      placeholder="/media/references/…"
                      value={refForm.cover_image_url}
                      onChange={(e) =>
                        setRefForm((f) => ({
                          ...f,
                          cover_image_url: e.target.value,
                        }))
                      }
                      disabled={refBusy}
                    />
                    <div className="cover-actions">
                      <input
                        type="file"
                        accept="image/*"
                        ref={coverInputRef}
                        onChange={onCoverPick}
                        hidden
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => coverInputRef.current?.click()}
                        disabled={refBusy}
                      >
                        Загрузить обложку…
                      </button>
                      {refForm.cover_image_url && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() =>
                            setRefForm((f) => ({
                              ...f,
                              cover_image_url: '',
                            }))
                          }
                          disabled={refBusy}
                        >
                          Убрать
                        </button>
                      )}
                    </div>
                    {refForm.cover_image_url && (
                      <div className="cover-preview">
                        <img
                          src={refForm.cover_image_url}
                          alt="обложка"
                        />
                      </div>
                    )}
                  </label>
                </div>

                <label className="field">
                  <span>Краткое описание</span>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={refForm.summary}
                    onChange={(e) =>
                      setRefForm((f) => ({ ...f, summary: e.target.value }))
                    }
                    disabled={refBusy}
                  />
                </label>

                <label className="field">
                  <span>Текст статьи</span>
                  <textarea
                    rows={12}
                    maxLength={50000}
                    value={refForm.content}
                    onChange={(e) =>
                      setRefForm((f) => ({ ...f, content: e.target.value }))
                    }
                    disabled={refBusy}
                    placeholder="Основной текст справки. Абзацы отделяются пустой строкой."
                  />
                </label>

                <div className="field">
                  <span>Прикреплённые изображения</span>
                  <div className="cover-actions">
                    <input
                      type="file"
                      accept="image/*"
                      ref={galleryInputRef}
                      onChange={onGalleryPick}
                      multiple
                      hidden
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => galleryInputRef.current?.click()}
                      disabled={refBusy}
                    >
                      Добавить изображения…
                    </button>
                    <small className="muted">
                      JPG / PNG / WEBP / GIF, до 8 МБ
                    </small>
                  </div>
                  {refForm.images.length > 0 && (
                    <div className="gallery-edit">
                      {refForm.images.map((url) => (
                        <div key={url} className="gallery-edit__item">
                          <img src={url} alt="" loading="lazy" />
                          <button
                            type="button"
                            className="gallery-edit__remove"
                            onClick={() => removeGalleryImage(url)}
                            disabled={refBusy}
                            aria-label="Удалить изображение"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="form-actions">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={refBusy}
                  >
                    {refBusy
                      ? 'Сохраняем…'
                      : refEditingId != null
                        ? 'Сохранить'
                        : 'Опубликовать'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setShowRefForm(false)
                      resetRefForm()
                    }}
                    disabled={refBusy}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            </div>
          )}

          {refsLoading ? (
            <div className="muted">Загрузка…</div>
          ) : refs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">📖</div>
              <p className="muted">В справочнике пока нет статей.</p>
            </div>
          ) : (
            <div className="events-table-wrap">
              <table className="events-table">
                <thead>
                  <tr>
                    <th>Категория</th>
                    <th>Обложка</th>
                    <th>Название</th>
                    <th>Slug</th>
                    <th>Изобр.</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {refs.map((r) => (
                    <tr key={r.id}>
                      <td>{r.category || '—'}</td>
                      <td>
                        {r.cover_image_url ? (
                          <div className="events-table__cover">
                            <img
                              src={r.cover_image_url}
                              alt=""
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="events-table__title">
                          <Link to={`/reference/${r.slug}`}>{r.title}</Link>
                        </div>
                        {r.summary && (
                          <div className="events-table__desc">
                            {r.summary}
                          </div>
                        )}
                        {r.images.length > 0 && (
                          <div className="events-table__thumbs">
                            {r.images.slice(0, 6).map((url) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="events-table__thumb"
                              >
                                <img src={url} alt="" loading="lazy" />
                              </a>
                            ))}
                            {r.images.length > 6 && (
                              <span className="events-table__thumb-more">
                                +{r.images.length - 6}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <code className="mono">{r.slug}</code>
                      </td>
                      <td>{r.images.length + (r.cover_image_url ? 1 : 0)}</td>

                      <td className="events-table__actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => startRefEdit(r)}
                          disabled={refBusy}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() => onRefDelete(r.id)}
                          disabled={refBusy}
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

      {tab === 'users' && (() => {
        const activeUsers = users.filter((u) => u.is_active)
        const blockedUsers = users.filter((u) => !u.is_active)
        const shownUsers =
          usersView === 'active' ? activeUsers : blockedUsers
        return (
        <div className="admin-section">
          <div className="admin-section__head">
            <h2 className="admin-section__title">Пользователи</h2>
          </div>

          <div className="admin-tabs">
            <button
              type="button"
              className={`admin-tab ${usersView === 'active' ? 'is-active' : ''}`}
              onClick={() => setUsersView('active')}
            >
              ✅ Активные ({activeUsers.length})
            </button>
            <button
              type="button"
              className={`admin-tab ${usersView === 'blocked' ? 'is-active' : ''}`}
              onClick={() => setUsersView('blocked')}
            >
              🚫 Заблокированные ({blockedUsers.length})
            </button>
          </div>

          {usersError && <div className="alert alert-error">{usersError}</div>}

          {usersLoading ? (
            <div className="muted">Загрузка…</div>
          ) : shownUsers.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">
                {usersView === 'active' ? '👥' : '🚫'}
              </div>
              <p className="muted">
                {usersView === 'active'
                  ? 'Активных пользователей пока нет.'
                  : 'Заблокированных пользователей нет.'}
              </p>
            </div>
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
                  {shownUsers.map((u) => (
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
        )
      })()}
    </section>
  )
}
