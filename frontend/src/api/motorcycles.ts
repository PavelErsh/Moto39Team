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

export interface PublicUser {
  id: number
  username: string
  full_name: string | null
  created_at: string
  motorcycles: Motorcycle[]
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
  lat: number
  lng: number
  accuracy: number | null
  last_seen_at: string
}

export async function apiUpdateMyLocation(payload: {
  lat: number
  lng: number
  accuracy?: number | null
}): Promise<UserLocation> {
  const res = await api.post<UserLocation>('/users/me/location', payload)
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
