import { api } from './client'

export interface RideItem {
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

export interface RidePayload {
  event_date: string
  end_date?: string | null
  title: string
  organizer: string
  location: string
  description?: string | null
  cover_image_url?: string | null
  images?: string[]
}

export async function apiListRides(): Promise<RideItem[]> {
  const res = await api.get<RideItem[]>('/rides')
  return res.data
}

export async function apiGetRide(id: number | string): Promise<RideItem> {
  const res = await api.get<RideItem>(`/rides/${id}`)
  return res.data
}

export async function apiCreateRide(data: RidePayload): Promise<RideItem> {
  const res = await api.post<RideItem>('/rides', data)
  return res.data
}

export async function apiUpdateRide(
  id: number,
  data: Partial<RidePayload>,
): Promise<RideItem> {
  const res = await api.patch<RideItem>(`/rides/${id}`, data)
  return res.data
}

export async function apiDeleteRide(id: number): Promise<void> {
  await api.delete(`/rides/${id}`)
}

export async function apiUploadRideImage(
  file: File,
): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ url: string }>('/rides/upload-image', form, {
    headers: { 'Content-Type': undefined as unknown as string },
  })
  return res.data
}
