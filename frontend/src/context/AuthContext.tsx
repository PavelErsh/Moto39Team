import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  apiDeleteAvatar,
  apiLogin,
  apiLogout,
  apiMe,
  apiRegisterStart,
  apiResendCode,
  apiUpdateMe,
  apiUploadAvatar,
  apiVerifyEmail,
  type RegisterPayload,
  type RegisterStartResponse,
  type UpdateUserPayload,
  type User,
} from '../api/auth'
import { tokenStorage } from '../api/client'
import {
  startBackgroundLocation,
  stopBackgroundLocation,
} from '../services/backgroundLocation'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  /**
   * Начать регистрацию — отправить на email код подтверждения.
   * Ничего не логинит и не сохраняет — только просит бэкенд отправить
   * письмо. Реальное создание пользователя происходит в `verifyEmail`.
   *
   * ВАЖНО: сначала полностью сбрасываем текущую сессию (если она была),
   * чтобы новый пользователь ни при каких условиях не получил доступ
   * к чужому аккаунту. Без этого на общих устройствах возможна была
   * ситуация: в localStorage лежат токены прошлого пользователя, свежий
   * `apiMe()` внутри `apiVerifyEmail` возвращает чужие данные, и
   * приложение отрисовывает не тот кабинет.
   */
  registerStart: (data: RegisterPayload) => Promise<RegisterStartResponse>
  /** Подтвердить email кодом из письма и залогинить пользователя. */
  verifyEmail: (email: string, code: string) => Promise<void>
  /** Повторно отправить код подтверждения. */
  resendCode: (email: string) => Promise<RegisterStartResponse>
  logout: () => void
  updateProfile: (data: UpdateUserPayload) => Promise<User>
  uploadAvatar: (file: File) => Promise<User>
  deleteAvatar: () => Promise<User>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Ключ, под которым храним last-known-good профиль пользователя.
// Нужен, чтобы при повторном открытии приложения мгновенно отрисовать
// UI без ожидания сетевого apiMe() — свежий профиль всё равно догрузится
// в фоне и, если что-то изменилось, обновит state.
const USER_CACHE_KEY = 'moto39_user_cache'

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

function writeCachedUser(u: User | null): void {
  try {
    if (u) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u))
    else localStorage.removeItem(USER_CACHE_KEY)
  } catch {
    /* noop */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Синхронно гидратируем пользователя из localStorage: если валидный
  // access-token уже есть, UI не должен «висеть» на splash-спиннере,
  // пока летит фоновый apiMe(). Если токена нет — считаем, что не
  // залогинен, и сразу снимаем loading.
  const initialUser =
    typeof window !== 'undefined' && tokenStorage.getAccess()
      ? readCachedUser()
      : null
  const [user, setUser] = useState<User | null>(initialUser)
  const [loading, setLoading] = useState(initialUser === null)
  // Актуальная «эпоха» токенов, к которой относится состояние `user`.
  // Любой асинхронный запрос профиля запоминает эпоху ДО старта и
  // применяет результат, только если она не менялась с тех пор.
  // Это защищает от классической гонки: медленный ответ старого apiMe()
  // не должен перезаписать данные нового пользователя, который успел
  // залогиниться/зарегистрироваться, пока запрос летел.
  const epochRef = useRef<number>(tokenStorage.getEpoch())

  /**
   * Аккуратный setUser: применяем состояние, только если эпоха токенов
   * не изменилась с момента запуска операции.
   */
  const applyUser = useCallback(
    (next: User | null, expectedEpoch: number) => {
      if (tokenStorage.getEpoch() !== expectedEpoch) {
        // Пока асинхронщина летела, кто-то перещёлкнул токены
        // (login/register/logout) — игнорируем устаревший результат.
        return
      }
      epochRef.current = expectedEpoch
      setUser(next)
      writeCachedUser(next)
    },
    [],
  )

  const refreshUser = useCallback(async () => {
    const epoch = tokenStorage.getEpoch()
    if (!tokenStorage.getAccess()) {
      applyUser(null, epoch)
      return
    }
    try {
      const me = await apiMe()
      applyUser(me, epoch)
    } catch {
      // apiMe упал — сессия невалидна. Сбрасываем токены и
      // обнуляем пользователя (только если эпоха не менялась).
      if (tokenStorage.getEpoch() === epoch) {
        tokenStorage.clear()
        // После clear() эпоха сдвинулась — но нам как раз нужно
        // безусловно занулить пользователя.
        setUser(null)
        writeCachedUser(null)
      }
    }
  }, [applyUser])

  useEffect(() => {
    ;(async () => {
      await refreshUser()
      setLoading(false)
    })()
  }, [refreshUser])

  // Как только у нас появляется авторизованный пользователь — запускаем
  // фоновый трекинг геолокации. Работает только в нативной обёртке
  // Capacitor (Android/iOS), на вебе это no-op — там координаты шлёт
  // сама страница «Карта».
  useEffect(() => {
    if (user) {
      void startBackgroundLocation()
    } else {
      void stopBackgroundLocation()
    }
  }, [user])

  const login = useCallback(async (username: string, password: string) => {
    // Гарантируем, что если в localStorage болтались чужие токены —
    // они будут перезатёрты apiLogin'ом атомарно, а мы точно применим
    // только СВЕЖЕГО пользователя. bumpEpoch внутри tokenStorage.set/clear
    // обеспечит корректное игнорирование любых параллельных apiMe.
    tokenStorage.clear()
    const me = await apiLogin(username, password)
    const epoch = tokenStorage.getEpoch()
    applyUser(me, epoch)
  }, [applyUser])

  const registerStart = useCallback(
    async (data: RegisterPayload) => {
      // На всякий случай очищаем токены прежней сессии, чтобы
      // /auth/register не полетел с чужим Bearer, а последующий
      // /auth/verify-email гарантированно относился к новому пользователю.
      tokenStorage.clear()
      setUser(null)
      return apiRegisterStart(data)
    },
    [],
  )

  const verifyEmail = useCallback(
    async (email: string, code: string) => {
      // apiVerifyEmail сам вызывает tokenStorage.set(...) новыми токенами
      // и следом apiMe(). После этого текущая эпоха — уже «эпоха нового
      // пользователя», и applyUser корректно применит его в state,
      // а любые pending apiMe от предыдущей сессии будут проигнорированы.
      const me = await apiVerifyEmail(email, code)
      const epoch = tokenStorage.getEpoch()
      applyUser(me, epoch)
    },
    [applyUser],
  )

  const resendCode = useCallback(
    async (email: string) => apiResendCode(email),
    [],
  )

  const logout = useCallback(() => {
    // Выключаем фоновый трекер до сброса токенов, иначе последний фикс
    // может уйти на бэкенд без авторизации (получим 401).
    void stopBackgroundLocation()
    apiLogout()
    setUser(null)
    writeCachedUser(null)
  }, [])

  const updateProfile = useCallback(async (data: UpdateUserPayload) => {
    const me = await apiUpdateMe(data)
    setUser(me)
    writeCachedUser(me)
    return me
  }, [])

  const uploadAvatar = useCallback(async (file: File) => {
    const me = await apiUploadAvatar(file)
    setUser(me)
    writeCachedUser(me)
    return me
  }, [])

  const deleteAvatar = useCallback(async () => {
    const me = await apiDeleteAvatar()
    setUser(me)
    writeCachedUser(me)
    return me
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      registerStart,
      verifyEmail,
      resendCode,
      logout,
      updateProfile,
      uploadAvatar,
      deleteAvatar,
      refreshUser,
    }),
    [
      user,
      loading,
      login,
      registerStart,
      verifyEmail,
      resendCode,
      logout,
      updateProfile,
      uploadAvatar,
      deleteAvatar,
      refreshUser,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
