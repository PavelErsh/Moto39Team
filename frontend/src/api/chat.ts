import { api } from './client'

export interface ChatRoomItem {
  id: number
  name: string | null
  room_type: string
  created_by: number | null
  created_at: string
  updated_at: string
  last_message: MessageItem | null
  unread_count: number
  member_count: number
  dm_partner_name: string | null
  dm_partner_avatar_url: string | null
  notifications_enabled: boolean
}

export interface ChatRoomDetail extends ChatRoomItem {
  members: ChatMemberItem[]
}

export interface ChatMemberItem {
  id: number
  user_id: number
  role: string
  joined_at: string
  username: string | null
  avatar_url: string | null
  sponsor_badge: string | null
}

export interface MessageItem {
  id: number
  room_id: number
  sender_id: number | null
  content: string | null
  message_type: string
  image_url: string | null
  is_deleted: boolean
  created_at: string
  updated_at: string
  sender_full_name: string | null
  sender_username: string | null
  sender_avatar_url: string | null
  sender_sponsor_badge: string | null
  reply_to: ReplyMessageItem | null
  reactions: MessageReactionItem[]
}

export interface ReplyMessageItem {
  id: number
  sender_id: number | null
  sender_full_name: string | null
  sender_username: string | null
  content: string | null
  message_type: string
  image_url: string | null
  is_deleted: boolean
}

export interface MessageReactionItem {
  emoji: string
  count: number
  reacted_by_me: boolean
}

export interface UnreadCounts {
  total: number
  rooms: Record<number, number>
}

// ── Комнаты ─────────────────────────────────────────────────────

export async function apiListRooms(): Promise<ChatRoomItem[]> {
  const res = await api.get<ChatRoomItem[]>('/chat/rooms')
  return res.data
}

export async function apiCreateRoom(data: {
  name?: string | null
  room_type?: string
  member_ids: number[]
}): Promise<ChatRoomDetail> {
  const res = await api.post<ChatRoomDetail>('/chat/rooms', data)
  return res.data
}

export async function apiGetRoom(id: number): Promise<ChatRoomDetail> {
  const res = await api.get<ChatRoomDetail>(`/chat/rooms/${id}`)
  return res.data
}

export async function apiAddMembers(
  roomId: number,
  userIds: number[],
): Promise<void> {
  await api.post(`/chat/rooms/${roomId}/members`, { user_ids: userIds })
}

export async function apiRemoveMembers(
  roomId: number,
  userIds: number[],
): Promise<void> {
  await api.delete(`/chat/rooms/${roomId}/members`, { data: { user_ids: userIds } })
}

// ── Сообщения ───────────────────────────────────────────────────

export async function apiGetMessages(
  roomId: number,
  beforeId?: number,
  limit = 50,
): Promise<MessageItem[]> {
  const params: Record<string, string> = { limit: String(limit) }
  if (beforeId) params.before_id = String(beforeId)
  const res = await api.get<MessageItem[]>(`/chat/rooms/${roomId}/messages`, { params })
  return res.data
}

export async function apiUploadChatImage(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ url: string }>('/chat/upload-image', form, {
    headers: { 'Content-Type': undefined as unknown as string },
    signal,
    onUploadProgress: (event) => {
      if (!onProgress) return
      const total = event.total ?? 0
      if (total <= 0) {
        onProgress(0)
        return
      }
      onProgress(Math.max(0, Math.min(100, Math.round((event.loaded / total) * 100))))
    },
  })
  return res.data
}

export async function apiMarkRead(roomId: number, messageId: number): Promise<void> {
  await api.post(`/chat/rooms/${roomId}/read`, null, {
    params: { message_id: messageId },
  })
}

export async function apiGetUnread(): Promise<UnreadCounts> {
  const res = await api.get<UnreadCounts>('/chat/unread')
  return res.data
}

export async function apiUpdateRoomNotifications(
  roomId: number,
  notificationsEnabled: boolean,
): Promise<ChatRoomItem> {
  const res = await api.put<ChatRoomItem>(`/chat/rooms/${roomId}/notifications`, {
    notifications_enabled: notificationsEnabled,
  })
  return res.data
}
