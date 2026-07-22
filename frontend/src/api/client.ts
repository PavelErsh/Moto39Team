import axios, { AxiosError } from 'axios'

// По умолчанию используем относительный путь — тогда запросы идут по тому же
// протоколу и хосту, что и фронт (например, https://192.168.x.x:5173/api/v1),
// а Vite dev-сервер проксирует их на локальный бэкенд FastAPI.
// Это критично для мобильных браузеров, которые блокируют смешанный контент
// (HTTPS-страница → HTTP API) и не разрешают доступ к геолокации на http.
const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) || '/api/v1'


export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

const ACCESS_KEY = 'moto39_access_token'
const REFRESH_KEY = 'moto39_refresh_token'

export const tokenStorage = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  set: (access: string, refresh: string) => {
    localStorage.setItem(ACCESS_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

// Проставляем access-токен в каждый запрос
api.interceptors.request.use((config) => {
  const token = tokenStorage.getAccess()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Автоматическое обновление токена при 401
let refreshingPromise: Promise<string | null> | null = null

async function refreshTokens(): Promise<string | null> {
  const refresh = tokenStorage.getRefresh()
  if (!refresh) return null
  try {
    const { data } = await axios.post(`${API_URL}/auth/refresh`, {
      refresh_token: refresh,
    })
    tokenStorage.set(data.access_token, data.refresh_token)
    return data.access_token as string
  } catch {
    tokenStorage.clear()
    return null
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & {
      _retry?: boolean
    })
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !original.url?.includes('/auth/login') &&
      !original.url?.includes('/auth/refresh')
    ) {
      original._retry = true
      refreshingPromise = refreshingPromise ?? refreshTokens()
      const newToken = await refreshingPromise
      refreshingPromise = null
      if (newToken) {
        original.headers = original.headers ?? {}
        ;(original.headers as Record<string, string>).Authorization =
          `Bearer ${newToken}`
        return api.request(original)
      }
    }
    return Promise.reject(error)
  },
)

export function extractApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return detail
        .map((e: { loc?: unknown[]; msg?: string }) => {
          const loc = Array.isArray(e.loc) ? e.loc.slice(1).join('.') : ''
          return loc ? `${loc}: ${e.msg}` : e.msg ?? ''
        })
        .filter(Boolean)
        .join('; ')
    }
    return err.message
  }
  return 'Неизвестная ошибка'
}
