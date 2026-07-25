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
  apiRegister,
  apiUpdateMe,
  apiUploadAvatar,
  type RegisterPayload,
  type UpdateUserPayload,
  type User,
} from '../api/auth'
import { tokenStorage } from '../api/client'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (data: RegisterPayload) => Promise<void>
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

  const login = useCallback(async (username: string, password: string) => {
    const me = await apiLogin(username, password)
    setUser(me)
  }, [])

  const register = useCallback(
    async (data: RegisterPayload) => {
      await apiRegister(data)
      await login(data.username, data.password)
    },
    [login],
  )

  const logout = useCallback(() => {
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
      register,
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
      register,
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
