import { useEffect, useRef, useState } from 'react'

/**
 * Мини-карта с одной меткой — последним известным местоположением
 * пользователя. Используется в публичном профиле райдера.
 *
 * Реализация полностью повторяет подход из ``MapPage``: если задан ключ
 * Яндекс.Карт (``VITE_YANDEX_MAPS_API_KEY``) — грузим Яндекс, иначе
 * fallback на Leaflet + OpenStreetMap. Хранение загрузчиков в
 * ``window.__leafletLoader`` / ``window.__ymapsLoader`` совпадает с
 * основной картой, чтобы избежать повторной инициализации.
 */

const YANDEX_API_KEY = (import.meta.env.VITE_YANDEX_MAPS_API_KEY as
  | string
  | undefined
  | '')?.trim()

const USE_YANDEX = Boolean(YANDEX_API_KEY)

declare global {
  interface Window {
    ymaps?: any
    __ymapsLoader?: Promise<any>
    L?: any
    __leafletLoader?: Promise<any>
  }
}

function loadYandexMaps(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject('no window')
  if (window.ymaps && window.ymaps.Map) return Promise.resolve(window.ymaps)
  if (window.__ymapsLoader) return window.__ymapsLoader

  const params = new URLSearchParams({
    lang: 'ru_RU',
    coordorder: 'latlong',
  })
  if (YANDEX_API_KEY) params.set('apikey', YANDEX_API_KEY)

  const src = `https://api-maps.yandex.ru/2.1/?${params.toString()}`

  window.__ymapsLoader = new Promise((resolve, reject) => {
    const onReady = () => {
      if (!window.ymaps) return reject(new Error('ymaps not available'))
      window.ymaps.ready(() => resolve(window.ymaps))
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-ymaps="1"]',
    )
    if (existing) {
      existing.addEventListener('load', onReady, { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error('Не удалось загрузить Яндекс.Карты')),
        { once: true },
      )
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.defer = true
    s.dataset.ymaps = '1'
    s.onload = onReady
    s.onerror = () => reject(new Error('Не удалось загрузить Яндекс.Карты'))
    document.head.appendChild(s)
  })

  return window.__ymapsLoader
}

const LEAFLET_CDNS: Array<{ css: string; js: string }> = [
  {
    css: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
    js: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  },
  {
    css: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
    js: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  },
  {
    css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  },
]

function loadLeafletCss(href: string): void {
  if (document.querySelector(`link[data-leaflet-css="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.dataset.leaflet = '1'
  link.dataset.leafletCss = href
  document.head.appendChild(link)
}

function loadLeafletScript(src: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.defer = true
    s.dataset.leaflet = '1'
    s.onload = () => {
      if (window.L) resolve(window.L)
      else reject(new Error('Leaflet не инициализировался'))
    }
    s.onerror = () =>
      reject(new Error(`Не удалось загрузить Leaflet с ${src}`))
    document.head.appendChild(s)
  })
}

function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject('no window')
  if (window.L) return Promise.resolve(window.L)
  if (window.__leafletLoader) return window.__leafletLoader

  window.__leafletLoader = (async () => {
    let lastErr: unknown = null
    for (const cdn of LEAFLET_CDNS) {
      try {
        loadLeafletCss(cdn.css)
        const L = await loadLeafletScript(cdn.js)
        return L
      } catch (e) {
        lastErr = e
        continue
      }
    }
    throw new Error(
      (lastErr as Error)?.message ||
        'Не удалось загрузить карту (Leaflet).',
    )
  })()

  return window.__leafletLoader
}

interface Props {
  lat: number
  lng: number
  label?: string
  zoom?: number
}

export default function RiderLocationMap({
  lat,
  lng,
  label,
  zoom = 13,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loader = USE_YANDEX ? loadYandexMaps() : loadLeaflet()

    loader
      .then((lib) => {
        if (cancelled || !containerRef.current) return
        const point: [number, number] = [lat, lng]

        if (USE_YANDEX) {
          const ymaps = lib
          const map = new ymaps.Map(
            containerRef.current,
            {
              center: point,
              zoom,
              controls: ['zoomControl'],
            },
            { suppressMapOpenBlock: true },
          )
          const placemark = new ymaps.Placemark(
            point,
            {
              balloonContent: label || 'Последняя точка',
              hintContent: label || 'Последняя точка',
            },
            {
              preset: 'islands#redCircleDotIcon',
              iconColor: '#ff2a2a',
            },
          )
          map.geoObjects.add(placemark)
          mapRef.current = map
        } else {
          const L = lib
          const map = L.map(containerRef.current, {
            center: point,
            zoom,
            zoomControl: true,
            attributionControl: false,
            // Мини-карта: колесо мыши обычно мешает скроллу страницы —
            // включаем только по клику на карту.
            scrollWheelZoom: false,
          })
          L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            { maxZoom: 19, attribution: '' },
          ).addTo(map)
          const marker = L.circleMarker(point, {
            radius: 8,
            color: '#ff2a2a',
            weight: 2,
            fillColor: '#ff2a2a',
            fillOpacity: 0.9,
          }).addTo(map)
          if (label) {
            marker.bindTooltip(label, { direction: 'top', offset: [0, -6] })
            marker.bindPopup(label)
          }
          // Разрешаем скролл-зум по клику (чтобы можно было приблизить),
          // и снова блокируем при уходе фокуса.
          map.on('click', () => map.scrollWheelZoom.enable())
          map.on('mouseout', () => map.scrollWheelZoom.disable())
          mapRef.current = map

          setTimeout(() => {
            try {
              map.invalidateSize()
            } catch {
              /* noop */
            }
          }, 0)
        }
      })
      .catch((e) => {
        setError(
          e?.message || 'Не удалось загрузить карту с последним местоположением.',
        )
      })

    return () => {
      cancelled = true
      if (mapRef.current) {
        try {
          if (USE_YANDEX) {
            mapRef.current.destroy()
          } else {
            mapRef.current.remove()
          }
        } catch {
          /* noop */
        }
        mapRef.current = null
      }
    }
    // Пересоздаём карту, если координаты сменились (переход между
    // профилями). Это простой и надёжный вариант — заново нарисовать.
  }, [lat, lng, label, zoom])

  if (error) {
    return <div className="alert alert-error">{error}</div>
  }

  return <div ref={containerRef} className="rider-map" />
}
