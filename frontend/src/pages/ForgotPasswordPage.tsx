import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  apiAuthConfig,
  apiForgotPassword,
  apiResetPassword,
  type AuthConfig,
} from '../api/auth'
import { extractApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function ForgotPasswordPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [step, setStep] = useState<'request' | 'reset'>('request')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    apiAuthConfig()
      .then(setConfig)
      .catch(() => {
        setConfig({
          turnstile_enabled: false,
          turnstile_site_key: '',
          email_verification_enabled: true,
          email_code_length: 6,
          email_code_ttl_minutes: 15,
        })
      })
  }, [])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setInterval(() => setResendCooldown((s) => s - 1), 1000)
    return () => clearInterval(t)
  }, [resendCooldown])

  if (user) return <Navigate to="/cabinet" replace />

  const codeLength = config?.email_code_length ?? 6

  async function onSubmitRequest(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      const resp = await apiForgotPassword(email.trim())
      setInfo(
        `${resp.message}. Если адрес зарегистрирован, код действует ${resp.expires_in_minutes} мин.`,
      )
      setStep('reset')
      setResendCooldown(60)
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitReset(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    if (newPassword.length < 8) {
      setError('Пароль должен быть не короче 8 символов')
      return
    }
    if (newPassword !== newPasswordConfirm) {
      setError('Пароли не совпадают')
      return
    }
    setBusy(true)
    try {
      const resp = await apiResetPassword({
        email: email.trim(),
        code: code.trim(),
        new_password: newPassword,
      })
      setInfo(resp.message)
      navigate('/login', {
        replace: true,
        state: { message: resp.message },
      })
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onResend() {
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      const resp = await apiForgotPassword(email.trim())
      setInfo(resp.message)
      setResendCooldown(60)
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (step === 'reset') {
    return (
      <section className="auth-card">
        <h1>Новый пароль</h1>

        {error && <div className="alert alert-error">{error}</div>}
        {info && <div className="alert alert-info">{info}</div>}

        <form className="form" onSubmit={onSubmitReset} noValidate>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} disabled />
          </label>
          <label className="field">
            <span>Код из письма</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={codeLength}
              required
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, '').slice(0, codeLength))
              }
              disabled={busy}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Новый пароль</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Повторите новый пароль</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={busy || code.length < codeLength}
          >
            {busy ? 'Сохраняем…' : 'Сменить пароль'}
          </button>
        </form>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="btn btn-link"
            onClick={() => {
              setStep('request')
              setCode('')
              setNewPassword('')
              setNewPasswordConfirm('')
              setError(null)
              setInfo(null)
            }}
            disabled={busy}
          >
            ← Изменить email
          </button>
          <button
            type="button"
            className="btn btn-link"
            onClick={onResend}
            disabled={busy || resendCooldown > 0}
          >
            {resendCooldown > 0
              ? `Отправить снова через ${resendCooldown} с`
              : 'Отправить код ещё раз'}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="auth-card">
      <h1>Восстановление пароля</h1>

      {error && <div className="alert alert-error">{error}</div>}
      {info && <div className="alert alert-info">{info}</div>}

      <form className="form" onSubmit={onSubmitRequest} noValidate>
        <label className="field">
          <span>Email, на который зарегистрирован аккаунт</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </label>
        <button
          type="submit"
          className="btn btn-primary btn-block btn-lg"
          disabled={busy || !email.trim()}
        >
          {busy ? 'Отправляем…' : 'Отправить код'}
        </button>
      </form>

      <p className="muted center">
        Вспомнили пароль? <Link to="/login">Вернуться ко входу</Link>
      </p>
    </section>
  )
}