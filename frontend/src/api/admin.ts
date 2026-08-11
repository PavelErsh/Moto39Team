import { api } from './client'
import type { User } from './auth'
import type { ChatMemberItem } from './chat'

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

export async function apiAdminListBikeChatUsers(): Promise<ChatMemberItem[]> {
  const res = await api.get<ChatMemberItem[]>('/admin/chat/bikechat/users')
  return res.data
}

export async function apiAdminListBikeChatAvailableUsers(): Promise<User[]> {
  const res = await api.get<User[]>('/admin/chat/bikechat/available-users')
  return res.data
}

export async function apiAdminAddBikeChatUser(
  userId: number,
): Promise<ChatMemberItem[]> {
  const res = await api.post<ChatMemberItem[]>(`/admin/chat/bikechat/users/${userId}`)
  return res.data
}

export async function apiAdminRemoveBikeChatUser(
  userId: number,
): Promise<ChatMemberItem[]> {
  const res = await api.delete<ChatMemberItem[]>(`/admin/chat/bikechat/users/${userId}`)
  return res.data
}
