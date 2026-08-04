import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { extractApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function CabinetPage() {
  const { user, updateProfile, uploadAvatar, deleteAvatar } = useAuth()

  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (user) {
      setEmail(user.email)
      setUsername(user.username)
      setFullName(user.full_name ?? '')
    }
  }, [user])

  if (!user) return null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const payload: Record<string, string | null> = {}
    if (email.trim() !== user!.email) payload.email = email.trim()
    if (username.trim() !== user!.username) payload.username = username.trim()
    const newFullName = fullName.trim() || null
    if (newFullName !== (user!.full_name ?? null)) payload.full_name = newFullName
    if (password) {
      if (password.length < 8) {
        setError('Новый пароль должен быть не короче 8 символов')
        return
      }
      payload.password = password
    }

    if (Object.keys(payload).length === 0) {
      setSuccess('Изменений нет')
      return
    }

    setBusy(true)
    try {
      await updateProfile(payload)
      setSuccess('Сохранено')
      setPassword('')
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Сбрасываем значение, чтобы можно было выбрать тот же файл повторно
    e.target.value = ''
    if (!file) return
    setError(null)
    setSuccess(null)
    setAvatarBusy(true)
    try {
      await uploadAvatar(file)
      setSuccess('Фото профиля обновлено')
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setAvatarBusy(false)
    }
  }

  async function onDeleteAvatar() {
    if (!user!.avatar_url) return
    if (!window.confirm('Удалить фото профиля?')) return
    setError(null)
    setSuccess(null)
    setAvatarBusy(true)
    try {
      await deleteAvatar()
      setSuccess('Фото профиля удалено')
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setAvatarBusy(false)
    }
  }

  const initial = (user.username[0] || '?').toUpperCase()

  return (
    <section className="cabinet">
      <header className="cabinet__head">
        <div className="avatar-wrap">
          {user.avatar_url ? (
            <div className="avatar avatar--image">
              <img src={user.avatar_url} alt={user.username} />
            </div>
          ) : (
            <div className="avatar">{initial}</div>
          )}
          <div className="avatar-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarBusy}
            >
              {avatarBusy
                ? 'Загрузка…'
                : user.avatar_url
                  ? 'Сменить фото'
                  : '📷 Загрузить фото'}
            </button>
            {user.avatar_url && (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                onClick={onDeleteAvatar}
                disabled={avatarBusy}
              >
                Удалить
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={onAvatarChange}
              style={{ display: 'none' }}
            />
          </div>
        </div>
        <div>
          <h1 className="cabinet__name">
            {user.full_name || user.username}
            {user.sponsor_badge && (
              <span
                className="sponsor-badge"
                title="Спонсор проекта"
              >
                {user.sponsor_badge}
              </span>
            )}
          </h1>
          <p className="muted">@{user.username}</p>
        </div>
        <div className="cabinet__actions">
          <Link to="/moto" className="btn btn-ghost btn-sm">
            🏍️ Мой гараж
          </Link>
          <Link
            to={`/u/${encodeURIComponent(user.username)}`}
            className="btn btn-ghost btn-sm"
          >
            Публичный профиль
          </Link>
        </div>
      </header>

      <div className="edit-card">
        {success && <div className="alert alert-success">{success}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        <form className="form" onSubmit={onSubmit} noValidate>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Логин</span>
            <input
              type="text"
              required
              minLength={3}
              maxLength={64}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Имя</span>
            <input
              type="text"
              maxLength={255}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Новый пароль</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              placeholder="Оставьте пустым, чтобы не менять"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={busy}
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
      </div>
    </section>
  )
}
