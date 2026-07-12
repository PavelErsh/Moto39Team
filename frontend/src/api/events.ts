import { api } from './client'

export interface EventItem {
  id: number
  event_date: string // ISO date (YYYY-MM-DD)
  title: string
  organizer: string
  location: string
  description: string | null
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface EventPayload {
  event_date: string
  title: string
  organizer: string
  location: string
  description?: string | null
}

export async function apiListEvents(): Promise<EventItem[]> {
  const res = await api.get<EventItem[]>('/events')
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
