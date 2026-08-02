import { api } from './client'

export interface Motorcycle {
  id: number
  user_id: number
  brand: string
  model: string
  year: number | null
  engine_cc: number | null
  color: string | null
  description: string | null
  photo_url: string | null
  created_at: string
  updated_at: string
}

export interface MotorcyclePayload {
  brand: string
  model: string
  year?: number | null
  engine_cc?: number | null
  color?: string | null
  description?: string | null
  photo_url?: string | null
}

export async function apiListMyMotorcycles(): Promise<Motorcycle[]> {
  const res = await api.get<Motorcycle[]>('/motorcycles/me')
  return res.data
}

export async function apiCreateMotorcycle(
  data: MotorcyclePayload,
): Promise<Motorcycle> {
  const res = await api.post<Motorcycle>('/motorcycles', data)
  return res.data
}

export async function apiUpdateMotorcycle(
  id: number,
  data: Partial<MotorcyclePayload>,
): Promise<Motorcycle> {
  const res = await api.patch<Motorcycle>(`/motorcycles/${id}`, data)
  return res.data
}

export async function apiDeleteMotorcycle(id: number): Promise<void> {
  await api.delete(`/motorcycles/${id}`)
}

export async function apiUploadMotorcyclePhoto(
  id: number,
  file: File,
): Promise<Motorcycle> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<Motorcycle>(`/motorcycles/${id}/photo`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function apiUploadMotorcycleImage(
  file: File,
): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<{ url: string }>('/motorcycles/upload-photo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export interface PublicUser {
  id: number
  username: string
  full_name: string | null
  avatar_url: string | null
  is_active?: boolean
  created_at: string
  motorcycles: Motorcycle[]
  // Последние известные координаты (могут отсутствовать, если пользователь
  // ни разу не делился геолокацией / отключил её).
  last_lat?: number | null
  last_lng?: number | null
  last_seen_at?: string | null
}

export async function apiGetPublicUser(username: string): Promise<PublicUser> {
  const res = await api.get<PublicUser>(
    `/users/by-username/${encodeURIComponent(username)}`,
  )
  return res.data
}

export async function apiListUsers(): Promise<PublicUser[]> {
  const res = await api.get<PublicUser[]>('/users')
  return res.data
}

export interface UserLocation {
  id: number
  username: string
  full_name: string | null
  avatar_url: string | null
  lat: number
  lng: number
  accuracy: number | null
  last_seen_at: string
  emergency_status: string | null
}

export async function apiUpdateMyLocation(payload: {
  lat: number
  lng: number
  accuracy?: number | null
}): Promise<UserLocation> {
  const res = await api.post<UserLocation>('/users/me/location', payload)
  return res.data
}

export async function apiUpdateEmergencyStatus(
  emergency_status: string | null,
): Promise<UserLocation> {
  // null — сброс статуса (белая метка), help — жёлтая, sos — красная
  const res = await api.post<UserLocation>('/users/me/emergency', {
    emergency_status: emergency_status ?? '',
  })
  return res.data
}

export async function apiListUserLocations(
  maxAgeMinutes?: number,
): Promise<UserLocation[]> {
  const res = await api.get<UserLocation[]>('/users/locations', {
    params:
      maxAgeMinutes !== undefined
        ? { max_age_minutes: maxAgeMinutes }
        : undefined,
  })
  return res.data
}
