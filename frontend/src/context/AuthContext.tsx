import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    if (!tokenStorage.getAccess()) {
      setUser(null)
      return
    }
    try {
      const me = await apiMe()
      setUser(me)
    } catch {
      tokenStorage.clear()
      setUser(null)
    }
  }, [])

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
    const me = await apiLogin(username, password)
    setUser(me)
  }, [])

  const registerStart = useCallback(
    async (data: RegisterPayload) => apiRegisterStart(data),
    [],
  )

  const verifyEmail = useCallback(async (email: string, code: string) => {
    const me = await apiVerifyEmail(email, code)
    setUser(me)
  }, [])

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
  }, [])

  const updateProfile = useCallback(async (data: UpdateUserPayload) => {
    const me = await apiUpdateMe(data)
    setUser(me)
    return me
  }, [])

  const uploadAvatar = useCallback(async (file: File) => {
    const me = await apiUploadAvatar(file)
    setUser(me)
    return me
  }, [])

  const deleteAvatar = useCallback(async () => {
    const me = await apiDeleteAvatar()
    setUser(me)
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
