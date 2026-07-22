import { api } from './client'

export interface ReferenceItem {
  id: number
  slug: string
  title: string
  category: string | null
  summary: string | null
  content: string
  cover_image_url: string | null
  images: string[]
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface ReferencePayload {
  slug: string
  title: string
  category?: string | null
  summary?: string | null
  content?: string
  cover_image_url?: string | null
  images?: string[]
}

export async function apiListReferences(): Promise<ReferenceItem[]> {
  const res = await api.get<ReferenceItem[]>('/references')
  return res.data
}

export async function apiGetReference(
  keyOrId: string | number,
): Promise<ReferenceItem> {
  const res = await api.get<ReferenceItem>(`/references/${keyOrId}`)
  return res.data
}

export async function apiCreateReference(
  data: ReferencePayload,
): Promise<ReferenceItem> {
  const res = await api.post<ReferenceItem>('/references', data)
  return res.data
}

export async function apiUpdateReference(
  id: number,
  data: Partial<ReferencePayload>,
): Promise<ReferenceItem> {
  const res = await api.patch<ReferenceItem>(`/references/${id}`, data)
  return res.data
}

export async function apiDeleteReference(id: number): Promise<void> {
  await api.delete(`/references/${id}`)
}

export async function apiUploadReferenceImage(
  file: File,
): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  // ВАЖНО: не задаём Content-Type вручную — axios/браузер сами поставят
  // 'multipart/form-data; boundary=...'. Если указать без boundary,
  // сервер вернёт 400 "Missing boundary in multipart" и картинка
  // не загрузится. Также явно сбрасываем дефолтный application/json,
  // чтобы он не «протёк» из настроек инстанса.
  const res = await api.post<{ url: string }>(
    '/references/upload-image',
    form,
    {
      headers: { 'Content-Type': undefined as unknown as string },
    },
  )
  return res.data
}
