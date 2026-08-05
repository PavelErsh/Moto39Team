import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { apiAuthConfig, type AuthConfig } from '../api/auth'
import { extractApiError } from '../api/client'
import LegalContent, { LEGAL_VERSION } from '../components/LegalContent'
import TurnstileWidget from '../components/TurnstileWidget'
import { useAuth } from '../context/AuthContext'

/**
 * Двухэтапная регистрация.
 *
 * Шаг 1 (`form`): вводим email/логин/пароль, читаем большое
 *   пользовательское соглашение (см. `LegalContent`) в прокручиваемом
 *   блоке и подтверждаем три чекбокса:
 *     1) согласие с условиями Соглашения и Политики;
 *     2) согласие на обработку персональных данных (ФЗ-152);
 *     3) подтверждение возраста 18+ и полной дееспособности.
 *   Также (если бэк требует) проходим капчу Cloudflare Turnstile.
 *   Отправляем на /auth/register — бэкенд шлёт код подтверждения.
 *
 * Шаг 2 (`verify`): вводим код из письма, отправляем на
 *   /auth/verify-email — бэкенд создаёт пользователя и логинит нас.
 *
 * ВАЖНО: чекбоксы соглашения — часть механизма защиты владельцев
 * сервиса от жалоб клиентов. Пользователь физически не может отправить
 * форму без явного и осознанного подтверждения — это подтверждает
 * акцепт публичной оферты (ст. 438 ГК РФ) и согласие на обработку
 * персональных данных (ст. 9 ФЗ-152).
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

  // --- Согласия
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePdn, setAgreePdn] = useState(false)
  const [agreeAge, setAgreeAge] = useState(false)
  // Пользователь должен «доскроллить» соглашение хотя бы до низа —
  // это распространённая практика: чекбоксы разблокируются только
  // после демонстрации, что текст был показан целиком.
  const [scrolledToEnd, setScrolledToEnd] = useState(false)
  const legalBoxRef = useRef<HTMLDivElement | null>(null)

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

  // Отслеживаем скролл блока соглашения: как только пользователь
  // добрался почти до низа (буфер 24 px, чтобы работало и с
  // округлением/зумом), считаем условие «прочитано» выполненным.
  useEffect(() => {
    const el = legalBoxRef.current
    if (!el) return
    const onScroll = () => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remaining <= 24) setScrolledToEnd(true)
    }
    // Если текст короче окна (например, зум/большой экран) — сразу
    // засчитываем прочтение.
    if (el.scrollHeight <= el.clientHeight + 24) {
      setScrolledToEnd(true)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [step])

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

  const allAgreed = agreeTerms && agreePdn && agreeAge

  async function onSubmitForm(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)

    if (!allAgreed) {
      setError(
        'Чтобы продолжить, подтвердите пользовательское соглашение, ' +
          'согласие на обработку персональных данных и своё совершеннолетие.',
      )
      return
    }
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
    <section className="auth-card auth-card--wide">
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

        {/* -------------------------------------------------------
            Пользовательское соглашение и Политика ПДн.
            Показываем полный текст в прокручиваемом блоке. Пока
            пользователь не докрутит его до конца — чекбоксы
            остаются выключенными (см. `scrolledToEnd`).
            ------------------------------------------------------- */}
        <div className="legal-block">
          <div className="legal-block__head">
            <h2 className="legal-block__title">
              Пользовательское соглашение и Политика обработки
              персональных данных
            </h2>
            <span className="legal-block__badge">
              Редакция {LEGAL_VERSION}
            </span>
          </div>
          <p className="legal-block__hint">
            Пожалуйста, внимательно прочитайте документ ниже до конца.
            Кнопки согласия станут активными, когда вы прокрутите
            текст до конца. Полную версию можно открыть на отдельной
            странице:{' '}
            <Link to="/legal" target="_blank" rel="noopener">
              /legal ↗
            </Link>
            .
          </p>

          <div
            ref={legalBoxRef}
            className={
              'legal-block__scroll' +
              (scrolledToEnd ? ' legal-block__scroll--read' : '')
            }
            tabIndex={0}
            aria-label="Пользовательское соглашение"
          >
            <LegalContent hideTitle />
          </div>

          {!scrolledToEnd && (
            <p className="legal-block__scroll-hint">
              ↓ Прокрутите текст до конца, чтобы активировать
              подтверждение
            </p>
          )}

          <div className="legal-block__checks">
            <label className="legal-check">
              <input
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                disabled={busy || !scrolledToEnd}
              />
              <span>
                Я прочитал(а) и принимаю{' '}
                <Link to="/legal" target="_blank" rel="noopener">
                  Пользовательское соглашение
                </Link>{' '}
                сервиса «Мото39Team» в полном объёме.
              </span>
            </label>

            <label className="legal-check">
              <input
                type="checkbox"
                checked={agreePdn}
                onChange={(e) => setAgreePdn(e.target.checked)}
                disabled={busy || !scrolledToEnd}
              />
              <span>
                Даю согласие на обработку моих{' '}
                <Link to="/legal" target="_blank" rel="noopener">
                  персональных данных
                </Link>{' '}
                в соответствии с ФЗ&nbsp;№&nbsp;152-ФЗ «О персональных
                данных» на условиях, описанных в Политике.
              </span>
            </label>

            <label className="legal-check">
              <input
                type="checkbox"
                checked={agreeAge}
                onChange={(e) => setAgreeAge(e.target.checked)}
                disabled={busy || !scrolledToEnd}
              />
              <span>
                Подтверждаю, что мне исполнилось <b>18 лет</b>, я
                обладаю полной дееспособностью и понимаю, что
                мотоциклетное движение является источником повышенной
                опасности. Использую Сервис на свой страх и риск.
              </span>
            </label>
          </div>
        </div>

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
          disabled={busy || !allAgreed}
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
