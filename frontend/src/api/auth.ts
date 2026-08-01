import { api, tokenStorage } from './client'

export interface User {
  id: number
  email: string
  username: string
  full_name: string | null
  avatar_url: string | null
  is_active: boolean
  is_superuser: boolean
  created_at: string
  updated_at: string
}

export interface RegisterPayload {
  email: string
  username: string
  password: string
  full_name?: string | null
  turnstile_token?: string | null
}

export interface UpdateUserPayload {
  email?: string
  username?: string
  full_name?: string | null
  password?: string
  avatar_url?: string | null
}

export interface RegisterStartResponse {
  email: string
  message: string
  expires_in_minutes: number
}

export interface AuthConfig {
  turnstile_enabled: boolean
  turnstile_site_key: string
  email_verification_enabled: boolean
  email_code_length: number
  email_code_ttl_minutes: number
}

export async function apiAuthConfig(): Promise<AuthConfig> {
  const res = await api.get<AuthConfig>('/auth/config')
  return res.data
}

/**
 * Начать регистрацию. Если верификация email включена — сервер отправит
 * код на почту и вернёт RegisterStartResponse. Если выключена — то же
 * тело ответа, но пользователь уже создан.
 */
export async function apiRegisterStart(
  data: RegisterPayload,
): Promise<RegisterStartResponse> {
  const res = await api.post<RegisterStartResponse>('/auth/register', data)
  return res.data
}

/**
 * Подтвердить email кодом. При успехе бэкенд сразу выдаёт токены —
 * авторизуемся и возвращаем текущего пользователя.
 */
export async function apiVerifyEmail(
  email: string,
  code: string,
): Promise<User> {
  const { data } = await api.post<{
    access_token: string
    refresh_token: string
  }>('/auth/verify-email', { email, code })
  tokenStorage.set(data.access_token, data.refresh_token)
  return apiMe()
}

export async function apiResendCode(
  email: string,
): Promise<RegisterStartResponse> {
  const res = await api.post<RegisterStartResponse>(
    '/auth/resend-code',
    { email },
  )
  return res.data
}

export async function apiLogin(
  username: string,
  password: string,
): Promise<User> {
  // OAuth2 password flow ожидает form-urlencoded
  const form = new URLSearchParams()
  form.set('username', username)
  form.set('password', password)
  const { data } = await api.post<{
    access_token: string
    refresh_token: string
  }>('/auth/login', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  tokenStorage.set(data.access_token, data.refresh_token)
  return apiMe()
}

export async function apiMe(): Promise<User> {
  const res = await api.get<User>('/auth/me')
  return res.data
}

export async function apiUpdateMe(payload: UpdateUserPayload): Promise<User> {
  const res = await api.patch<User>('/users/me', payload)
  return res.data
}

export async function apiUploadAvatar(file: File): Promise<User> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<User>('/users/me/avatar', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function apiDeleteAvatar(): Promise<User> {
  const res = await api.delete<User>('/users/me/avatar')
  return res.data
}

export function apiLogout(): void {
  tokenStorage.clear()
}
