import { api, tokenStorage } from './client'

export interface User {
  id: number
  email: string
  username: string
  full_name: string | null
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
}

export interface UpdateUserPayload {
  email?: string
  username?: string
  full_name?: string | null
  password?: string
}

export async function apiRegister(data: RegisterPayload): Promise<User> {
  const res = await api.post<User>('/auth/register', data)
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

export function apiLogout(): void {
  tokenStorage.clear()
}
