import { api } from './client'
import type { User } from './auth'

export async function apiAdminListUsers(): Promise<User[]> {
  const res = await api.get<User[]>('/admin/users')
  return res.data
}

export async function apiAdminSetSuperuser(
  userId: number,
  isSuperuser: boolean,
): Promise<User> {
  const res = await api.patch<User>(`/admin/users/${userId}/superuser`, {
    is_superuser: isSuperuser,
  })
  return res.data
}

export async function apiAdminSetActive(
  userId: number,
  isActive: boolean,
): Promise<User> {
  const res = await api.patch<User>(`/admin/users/${userId}/active`, {
    is_active: isActive,
  })
  return res.data
}

// Установить/сбросить значок спонсора у пользователя.
// Передаём пустую строку — на бэке нормализуется в NULL (снятие значка).
export async function apiAdminSetSponsorBadge(
  userId: number,
  badge: string | null,
): Promise<User> {
  const res = await api.patch<User>(
    `/admin/users/${userId}/sponsor-badge`,
    { sponsor_badge: badge ?? '' },
  )
  return res.data
}
