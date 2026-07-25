import axios, { AxiosError } from 'axios'
import { Capacitor } from '@capacitor/core'

// ---------------------------------------------------------------------------
// Определяем baseURL для API.
//
// 1) Веб (обычный браузер / собранная статика за nginx):
//    используем относительный путь `/api/v1`. Тогда запросы идут по тому же
//    протоколу и хосту, что и фронт (HTTPS-страница → HTTPS API), а Vite
//    dev-сервер проксирует их на FastAPI. Это критично для мобильных
//    браузеров: они блокируют смешанный контент и не отдают геолокацию
//    на http.
//
// 2) Нативная сборка Capacitor (Android/iOS):
//    страница подгружается с origin вида `capacitor://localhost` — там
//    нет никакого nginx-прокси, поэтому нужен абсолютный URL до бэкенда.
//    Задаём его через `VITE_API_URL` в `.env` (например
//    `https://moto39team.ru/api/v1`).
// ---------------------------------------------------------------------------
function resolveBaseUrl(): string {
  const explicit = (import.meta.env.VITE_API_URL as string | undefined)?.trim()
  if (explicit) return explicit
  try {
    if (Capacitor.isNativePlatform()) {
      // Fallback для нативной сборки, если забыли выставить env.
      // На проде должен быть выставлен VITE_API_URL.
      return 'https://moto39team.ru/api/v1'
    }
  } catch {
    /* noop */
  }
  return '/api/v1'
}

const API_URL = resolveBaseUrl()

/**
 * Публичный baseURL API. Используется, например, Service Worker'ом
 * для отправки координат при закрытой вкладке (см. sw.js).
 */
export const API_BASE_URL = API_URL

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
