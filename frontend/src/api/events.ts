import { api } from './client'

export interface EventItem {
  id: number
  event_date: string // ISO date (YYYY-MM-DD) — дата начала
  end_date: string | null // ISO date (YYYY-MM-DD) — дата окончания (опц.)
  title: string
  organizer: string
  location: string
  description: string | null
  cover_image_url: string | null
  images: string[]
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface EventPayload {
  event_date: string
  end_date?: string | null
  title: string
  organizer: string
  location: string
  description?: string | null
  cover_image_url?: string | null
  images?: string[]
}

export async function apiListEvents(): Promise<EventItem[]> {
  const res = await api.get<EventItem[]>('/events')
  return res.data
}

export async function apiGetEvent(id: number | string): Promise<EventItem> {
  const res = await api.get<EventItem>(`/events/${id}`)
  return res.data
}

export async function apiCreateEvent(data: EventPayload): Promise<EventItem> {
  const res = await api.post<EventItem>('/events', data)
  return res.data
}

export async function apiUpdateEvent(
  id: number,
  data: Partial<EventPayload>,
): Promise<EventItem> {
  const res = await api.patch<EventItem>(`/events/${id}`, data)
  return res.data
}

export async function apiDeleteEvent(id: number): Promise<void> {
  await api.delete(`/events/${id}`)
}

export async function apiUploadEventImage(
  file: File,
): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  // См. references.ts: не задаём Content-Type вручную, чтобы axios сам
  // выставил корректный multipart/form-data с boundary.
  const res = await api.post<{ url: string }>('/events/upload-image', form, {
    headers: { 'Content-Type': undefined as unknown as string },
  })
  return res.data
}
