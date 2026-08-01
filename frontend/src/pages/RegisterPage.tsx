import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { apiAuthConfig, type AuthConfig } from '../api/auth'
import { extractApiError } from '../api/client'
import TurnstileWidget from '../components/TurnstileWidget'
import { useAuth } from '../context/AuthContext'

/**
 * Двухэтапная регистрация.
 *
 * Шаг 1 (`form`): вводим email/логин/пароль и (если бэк требует)
 *   проходим капчу Cloudflare Turnstile. Отправляем на /auth/register —
 *   бэкенд шлёт код подтверждения на email.
 *
 * Шаг 2 (`verify`): вводим код из письма, отправляем на
 *   /auth/verify-email — бэкенд создаёт пользователя и логинит нас.
 */
export default function RegisterPage() {
  const { user, registerStart, verifyEmail, resendCode } = useAuth()
  const navigate = useNavigate()

  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [step, setStep] = useState<'form' | 'verify'>('form')

  // --- Форма шага 1
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

  // --- Форма шага 2
  const [code, setCode] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Тянем публичную конфигурацию (нужна ли капча, включена ли
    // верификация email, длина кода, срок жизни).
    apiAuthConfig()
      .then(setConfig)
      .catch(() => {
        // Не критично: если бэк недоступен, форма всё равно попытается
        // отправиться, а ошибку покажем позже.
        setConfig({
          turnstile_enabled: false,
          turnstile_site_key: '',
          email_verification_enabled: true,
          email_code_length: 6,
          email_code_ttl_minutes: 15,
        })
      })
  }, [])

  // Тикающий таймер для повторной отправки кода.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setInterval(() => setResendCooldown((s) => s - 1), 1000)
    return () => clearInterval(t)
  }, [resendCooldown])

  if (user) {
    return <Navigate to="/cabinet" replace />
  }

  const turnstileEnabled = !!config?.turnstile_enabled
  const turnstileSiteKey =
    (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ||
    config?.turnstile_site_key ||
    ''
  const codeLength = config?.email_code_length ?? 6
  const emailVerificationEnabled =
    config?.email_verification_enabled ?? true

  async function onSubmitForm(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)

    if (password !== passwordConfirm) {
      setError('Пароли не совпадают')
      return
    }
    if (password.length < 8) {
      setError('Пароль должен быть не короче 8 символов')
      return
    }
    if (turnstileEnabled && !turnstileToken) {
      setError('Пожалуйста, пройдите проверку капчи')
      return
    }

    setBusy(true)
    try {
      const resp = await registerStart({
        email: email.trim(),
        username: username.trim(),
        password,
        full_name: fullName.trim() || null,
        turnstile_token: turnstileToken,
      })

      if (!emailVerificationEnabled) {
        // Верификация выключена — бэкенд уже создал пользователя.
        // Просто попросим пользователя войти обычным способом.
        setInfo(
          'Регистрация выполнена. Теперь войдите под своим логином.',
        )
        navigate('/login', { replace: true })
        return
      }

      setInfo(
        `Код подтверждения отправлен на ${resp.email}. ` +
          `Он действует ${resp.expires_in_minutes} мин.`,
      )
      setResendCooldown(60)
      setStep('verify')
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitVerify(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      await verifyEmail(email.trim(), code.trim())
      navigate('/cabinet', { replace: true })
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
      await resendCode(email.trim())
      setInfo('Новый код отправлен на email.')
      setResendCooldown(60)
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (step === 'verify') {
    return (
      <section className="auth-card">
        <h1>Подтверждение email</h1>
        <p className="muted">
          Мы отправили код на <b>{email}</b>. Введите его ниже, чтобы
          закончить регистрацию.
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {info && <div className="alert alert-info">{info}</div>}

        <form className="form" onSubmit={onSubmitVerify} noValidate>
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

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={busy || code.length < codeLength}
          >
            {busy ? 'Проверяем…' : 'Подтвердить'}
          </button>
        </form>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="btn btn-link"
            onClick={() => {
              setStep('form')
              setCode('')
              setError(null)
              setInfo(null)
            }}
            disabled={busy}
          >
            ← Изменить данные
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
      <h1>Вступить</h1>

      {error && <div className="alert alert-error">{error}</div>}
      {info && <div className="alert alert-info">{info}</div>}

      <form className="form" onSubmit={onSubmitForm} noValidate>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
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
            autoComplete="username"
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
            autoComplete="name"
            maxLength={255}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>Пароль ещё раз</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            disabled={busy}
          />
        </label>

        {turnstileEnabled && turnstileSiteKey && (
          <div className="field">
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
            />
          </div>
        )}
        {turnstileEnabled && !turnstileSiteKey && (
          <div className="alert alert-error">
            Капча требуется, но site key не настроен на сервере.
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary btn-block btn-lg"
          disabled={busy}
        >
          {busy
            ? 'Отправляем…'
            : emailVerificationEnabled
              ? 'Получить код'
              : 'Вступить'}
        </button>
      </form>

      <p className="muted center">
        Уже с нами? <Link to="/login">Войти</Link>
      </p>
    </section>
  )
}
