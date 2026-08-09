import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { extractApiError } from '../api/client'
import { apiListUsers, type PublicUser } from '../api/motorcycles'
import { apiCreateRoom } from '../api/chat'

// Утилита: человекочитаемое «как давно был на связи».
function formatLastSeen(iso: string | null | undefined): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (diffSec < 60) return 'только что'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} мин назад`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH} ч назад`
  const diffD = Math.round(diffH / 24)
  if (diffD < 30) return `${diffD} д назад`
  const diffMo = Math.round(diffD / 30)
  if (diffMo < 12) return `${diffMo} мес назад`
  const diffY = Math.round(diffMo / 12)
  return `${diffY} г назад`
}

// Свежесть «онлайн» — активен последние 5 минут.
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000

// Как часто перезапрашиваем список райдеров с бэкенда.
// last_seen_at продвигается на любом активном запросе (в т.ч. на этом
// самом опросе — см. `deps.get_current_active_user`), поэтому 30 секунд
// хватает, чтобы список выглядел «живым».
const REFRESH_INTERVAL_MS = 30_000
// Как часто пересчитываем текст «X мин назад» без обращения к бэкенду.
// Нужен, чтобы отметка меняла статус «в сети → 1 мин назад → 2 мин…»
// в реальном времени, а не только при новом ответе API.
const TICK_INTERVAL_MS = 30_000

export default function RidersPage() {
  const [users, setUsers] = useState<PublicUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Счётчик тиков — заставляет пересчитать `sorted`/лейблы времени,
  // даже если список пользователей не обновлялся с бэкенда.
  const [, setTick] = useState(0)
  const navigate = useNavigate()

  /** Быстро открыть DM с райдером и перейти сразу в переписку */
  const startDm = useCallback(
    async (e: React.MouseEvent, userId: number) => {
      e.preventDefault() // чтобы не переходить по ссылке на профиль
      e.stopPropagation()
      try {
        const room = await apiCreateRoom({
          room_type: 'dm',
          member_ids: [userId],
        })
        navigate(`/chat?room=${room.id}`)
      } catch {
        // DM уже может существовать — переходим в чат
        navigate('/chat')
      }
    },
    [navigate],
  )

  useEffect(() => {
    let alive = true

    const fetchOnce = async () => {
      try {
        const data = await apiListUsers()
        if (!alive) return
        // Заблокированные пользователи не должны отображаться в общем
        // списке — даже если их вернул старый бэкенд без фильтрации.
        setUsers(data.filter((u) => u.is_active !== false))
        setError(null)
      } catch (err) {
        if (alive) setError(extractApiError(err))
      } finally {
        if (alive) setLoading(false)
      }
    }

    void fetchOnce()
    const refreshTimer = window.setInterval(fetchOnce, REFRESH_INTERVAL_MS)
    // Локальный «тик» — просто дёргаем стейт, чтобы React перерисовал
    // компонент и `formatLastSeen`/`isOnline` пересчитались от нового
    // `Date.now()`. Иначе, если сервер вернул тот же список, отметка
    // «только что» осталась бы навсегда.
    const tickTimer = window.setInterval(
      () => setTick((n) => (n + 1) % 1_000_000),
      TICK_INTERVAL_MS,
    )

    return () => {
      alive = false
      window.clearInterval(refreshTimer)
      window.clearInterval(tickTimer)
    }
  }, [])

  // Сортируем на клиенте на случай, если бэкенд ещё старой версии и
  // не отдаёт последовательность по last_seen_at. Порядок: сверху те,
  // кто был активен позже всех; в конце — никогда не выходившие.
  const sorted = useMemo(() => {
    const arr = [...users]
    arr.sort((a, b) => {
      const ta = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0
      const tb = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0
      if (tb !== ta) return tb - ta
      return a.username.localeCompare(b.username)
    })
    return arr
  }, [users])

  return (
    <section className="riders">
      <header className="garage__head">
        <div>
          <h1 className="garage__title">Райдеры</h1>
          <p className="muted">
            Сверху — те, кто был активен недавно. Кликни, чтобы увидеть на карте.
          </p>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? (
        <div className="muted">Загрузка…</div>
      ) : sorted.length === 0 ? (
        <div className="muted">Пусто</div>
      ) : (
        <div className="riders-grid">
          {sorted.map((u) => {
            const initial = (u.username[0] || '?').toUpperCase()
            const lastSeenText = formatLastSeen(u.last_seen_at)
            const isOnline = u.last_seen_at
              ? Date.now() - new Date(u.last_seen_at).getTime() <
                ONLINE_THRESHOLD_MS
              : false
            return (
              <div key={u.id} className="rider-card-wrapper" style={{ position: 'relative' }}>
                <Link
                  to={`/u/${encodeURIComponent(u.username)}`}
                  className="rider-card"
                  style={{ paddingRight: 48 }}
                >
                  {u.avatar_url ? (
                    <div className="avatar rider-card__avatar avatar--image">
                      <img src={u.avatar_url} alt={u.username} />
                    </div>
                  ) : (
                    <div className="avatar rider-card__avatar">{initial}</div>
                  )}
                  <div className="rider-card__body">
                    <div className="rider-card__name">
                      {u.full_name || u.username}
                      {u.sponsor_badge && (
                        <span className="sponsor-badge" title="Спонсор проекта">
                          {u.sponsor_badge}
                        </span>
                      )}
                    </div>
                    <div className="muted">@{u.username}</div>
                    <div className="rider-card__count">
                      🏍️ {u.motorcycles.length}
                    </div>
                    <div className="rider-card__seen">
                      {isOnline ? (
                        <span className="rider-card__online">● в сети</span>
                      ) : lastSeenText ? (
                        <span className="muted">был(а) {lastSeenText}</span>
                      ) : (
                        <span className="muted">давно не появлялся</span>
                      )}
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  className="btn btn-sm rider-dm-btn"
                  onClick={(e) => startDm(e, u.id)}
                  title="Написать в личные сообщения"
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    minWidth: 36,
                    padding: '6px 10px',
                    fontSize: 16,
                  }}
                >
                  💬
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
