import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { extractApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'

interface LocationState {
  from?: string
}

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) {
    return <Navigate to="/cabinet" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
      const from = (location.state as LocationState | null)?.from
      navigate(from && from !== '/login' ? from : '/cabinet', { replace: true })
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="auth-card">
      <h1>Вход</h1>

      {error && <div className="alert alert-error">{error}</div>}

      <form className="form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>Логин или email</span>
          <input
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input
            type="password"
            autoComplete="current-password"
            required
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
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>

      <p className="muted center">
        Ещё не с нами? <Link to="/register">Вступить</Link>
      </p>
    </section>
  )
}
