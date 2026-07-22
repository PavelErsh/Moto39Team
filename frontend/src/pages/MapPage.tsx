import { useEffect, useRef, useState } from 'react'
import {
  apiListUserLocations,
  apiUpdateMyLocation,
  type UserLocation,
} from '../api/motorcycles'

// Калининград — центр по умолчанию
const DEFAULT_CENTER: [number, number] = [54.7104, 20.4522]
const DEFAULT_ZOOM = 11
const MY_ZOOM = 15

// Как часто отправляем свои координаты на бэкенд, мс.
const LOCATION_PUSH_INTERVAL_MS = 30_000
// Как часто подтягиваем чужие координаты с бэкенда, мс.
const LOCATION_POLL_INTERVAL_MS = 30_000
// Свежесть чужих координат (минуты) — только те, кто был на связи недавно.
const RIDERS_MAX_AGE_MIN = 60 * 24

// Ключ Яндекс.Карт (опционально). Регистрируется в кабинете разработчика Яндекса.
// Если ключ не задан — используем бесплатный Leaflet + OpenStreetMap.
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

/* ------------------------- Загрузчики библиотек ------------------------- */

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

function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject('no window')
  if (window.L) return Promise.resolve(window.L)
  if (window.__leafletLoader) return window.__leafletLoader

  window.__leafletLoader = new Promise((resolve, reject) => {
    // CSS
    if (!document.querySelector('link[data-leaflet="1"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.integrity =
        'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
      link.crossOrigin = ''
      link.dataset.leaflet = '1'
      document.head.appendChild(link)
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-leaflet="1"]',
    )
    const onReady = () => {
      if (!window.L) return reject(new Error('Leaflet не загрузился'))
      resolve(window.L)
    }
    if (existing) {
      existing.addEventListener('load', onReady, { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error('Не удалось загрузить карту (Leaflet)')),
        { once: true },
      )
      return
    }
    const s = document.createElement('script')
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    s.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='
    s.crossOrigin = ''
    s.async = true
    s.defer = true
    s.dataset.leaflet = '1'
    s.onload = onReady
    s.onerror = () =>
      reject(new Error('Не удалось загрузить карту (Leaflet)'))
    document.head.appendChild(s)
  })

  return window.__leafletLoader
}

/* --------------------------- Утилиты форматов --------------------------- */

function formatLastSeen(iso: string): string {
  const then = new Date(iso).getTime()
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (diffSec < 60) return 'только что'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} мин назад`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH} ч назад`
  const diffD = Math.round(diffH / 24)
  return `${diffD} д назад`
}

/* ------------------------------ Компонент ------------------------------ */

export default function MapPage() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const meMarkerRef = useRef<any>(null)
  const accuracyCircleRef = useRef<any>(null)
  const watchIdRef = useRef<number | null>(null)
  const coordsRef = useRef<{ lat: number; lng: number; accuracy: number } | null>(
    null,
  )

  // Отдельная коллекция маркеров других райдеров: userId -> marker
  const riderMarkersRef = useRef<Map<number, any>>(new Map())
  const lastPushRef = useRef<number>(0)
  const lastPushedRef = useRef<{ lat: number; lng: number } | null>(null)

  const [status, setStatus] = useState<string>('Загружаем карту…')
  const [coords, setCoords] = useState<{
    lat: number
    lng: number
    accuracy: number
  } | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [riders, setRiders] = useState<UserLocation[]>([])

  // Инициализация карты
  useEffect(() => {
    let cancelled = false

    const loader = USE_YANDEX ? loadYandexMaps() : loadLeaflet()

    loader
      .then((lib) => {
        if (cancelled || !mapContainerRef.current) return

        if (USE_YANDEX) {
          const ymaps = lib
          const map = new ymaps.Map(
            mapContainerRef.current,
            {
              center: DEFAULT_CENTER,
              zoom: DEFAULT_ZOOM,
              controls: ['zoomControl', 'geolocationControl', 'typeSelector'],
            },
            { suppressMapOpenBlock: true },
          )
          mapRef.current = map
        } else {
          const L = lib
          const map = L.map(mapContainerRef.current, {
            center: DEFAULT_CENTER,
            zoom: DEFAULT_ZOOM,
            zoomControl: true,
            attributionControl: false,
          })
          L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
              maxZoom: 19,
              attribution: '',
            },
          ).addTo(map)
          mapRef.current = map
          // На случай, если контейнер стал видимым позже — пересчитать размеры
          setTimeout(() => {
            try {
              map.invalidateSize()
            } catch {
              /* noop */
            }
          }, 0)
        }

        setReady(true)
        setStatus('Определяем местоположение…')
      })
      .catch((e) => {
        setError(
          e?.message ||
            'Не удалось загрузить карту. Проверьте подключение к сети.',
        )
        setStatus('')
      })

    return () => {
      cancelled = true
      // Убираем маркеры других райдеров
      if (mapRef.current) {
        try {
          riderMarkersRef.current.forEach((marker) => {
            if (USE_YANDEX) {
              mapRef.current.geoObjects.remove(marker)
            } else {
              marker.remove()
            }
          })
        } catch {
          /* noop */
        }
      }
      riderMarkersRef.current.clear()

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
      meMarkerRef.current = null
      accuracyCircleRef.current = null
    }
  }, [])

  // Отправка своих координат на бэкенд (троттлинг)
  const pushMyLocation = (lat: number, lng: number, accuracy: number) => {
    const now = Date.now()
    const last = lastPushedRef.current
    // Не спамим одинаковые координаты. Отправляем, если:
    // - ещё не отправляли,
    // - прошло больше LOCATION_PUSH_INTERVAL_MS,
    // - или сместились более чем на ~10 м (грубо через дельту в градусах).
    const movedEnough =
      !last ||
      Math.abs(last.lat - lat) > 0.0001 ||
      Math.abs(last.lng - lng) > 0.0001
    if (
      now - lastPushRef.current >= LOCATION_PUSH_INTERVAL_MS ||
      (movedEnough && now - lastPushRef.current > 5_000)
    ) {
      lastPushRef.current = now
      lastPushedRef.current = { lat, lng }
      apiUpdateMyLocation({ lat, lng, accuracy }).catch(() => {
        // Тихо игнорируем: не критично для UX карты
      })
    }
  }

  // Геолокация — как только карта готова
  useEffect(() => {
    if (!ready) return
    if (!('geolocation' in navigator)) {
      setError('Геолокация не поддерживается вашим браузером.')
      setStatus('')
      return
    }

    const map = mapRef.current
    if (!map) return

    let firstFix = true
    // Максимально допустимая погрешность (метры). Всё, что хуже — считаем это
    // грубым Wi-Fi/IP-фиксом и игнорируем, ждём настоящий GPS.
    const GPS_ACCURACY_THRESHOLD = 200

    const onSuccess: PositionCallback = (pos) => {
      const { latitude, longitude, accuracy } = pos.coords

      // Отфильтровываем «мусорные» IP/Wi-Fi фиксы: если у нас ещё не было
      // точной позиции, а этот фикс явно грубый — просто игнорируем его.
      if (
        accuracy > GPS_ACCURACY_THRESHOLD &&
        (!coordsRef.current ||
          accuracy > (coordsRef.current.accuracy ?? Infinity))
      ) {
        if (!coordsRef.current) {
          setStatus(
            `Ждём GPS… (пока ±${Math.round(accuracy)} м — это IP/Wi-Fi)`,
          )
        }
        return
      }

      const next = { lat: latitude, lng: longitude, accuracy }
      coordsRef.current = next
      setCoords(next)
      setError(null)
      setStatus('')

      const point: [number, number] = [latitude, longitude]

      if (USE_YANDEX) {
        const ymaps = window.ymaps
        if (!ymaps) return

        if (!meMarkerRef.current) {
          meMarkerRef.current = new ymaps.Placemark(
            point,
            { balloonContent: 'Вы здесь', hintContent: 'Вы здесь' },
            {
              preset: 'islands#redCircleDotIcon',
              iconColor: '#ff2a2a',
            },
          )
          map.geoObjects.add(meMarkerRef.current)
        } else {
          meMarkerRef.current.geometry.setCoordinates(point)
        }

        if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = new ymaps.Circle(
            [point, accuracy],
            {},
            {
              fillColor: '#ff2a2a22',
              strokeColor: '#ff2a2a',
              strokeOpacity: 0.7,
              strokeWidth: 1,
            },
          )
          map.geoObjects.add(accuracyCircleRef.current)
        } else {
          accuracyCircleRef.current.geometry.setCoordinates(point)
          accuracyCircleRef.current.geometry.setRadius(accuracy)
        }

        if (firstFix) {
          map.setCenter(point, MY_ZOOM, { duration: 400 })
          firstFix = false
        }
      } else {
        const L = window.L
        if (!L) return

        if (!meMarkerRef.current) {
          meMarkerRef.current = L.circleMarker(point, {
            radius: 7,
            color: '#ff2a2a',
            weight: 2,
            fillColor: '#ff2a2a',
            fillOpacity: 0.9,
          })
            .addTo(map)
            .bindTooltip('Вы здесь', { direction: 'top', offset: [0, -6] })
        } else {
          meMarkerRef.current.setLatLng(point)
        }

        if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = L.circle(point, {
            radius: accuracy,
            color: '#ff2a2a',
            weight: 1,
            opacity: 0.7,
            fillColor: '#ff2a2a',
            fillOpacity: 0.13,
          }).addTo(map)
        } else {
          accuracyCircleRef.current.setLatLng(point)
          accuracyCircleRef.current.setRadius(accuracy)
        }

        if (firstFix) {
          map.setView(point, Math.max(map.getZoom(), MY_ZOOM), {
            animate: true,
          })
          firstFix = false
        }
      }

      // Отправляем свои координаты на бэкенд (для других райдеров).
      pushMyLocation(latitude, longitude, accuracy)
    }

    // Быстрый первый фикс (Wi-Fi/IP) — без пробуждения GPS,
    // чтобы моментально показать пользователя на карте.
    // Дальше — watchPosition с enableHighAccuracy для точного GPS-трекинга.
    const onError: PositionErrorCallback = (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        setError(
          'Доступ к геолокации запрещён. Разрешите в настройках браузера.',
        )
        setStatus('')
        return
      }
      // POSITION_UNAVAILABLE / TIMEOUT — транзиентно, GPS ещё не поймал сигнал.
      // Не сбрасываем уже полученные Wi-Fi-координаты, просто ждём следующий тик.
      if (!coordsRef.current) {
        setStatus('Определяем местоположение…')
      }
    }

    setStatus('Ждём GPS…')

    // Только высокоточный GPS-трекинг. Никаких быстрых Wi-Fi/IP fallback'ов —
    // они давали грубую позицию (иногда километры вбок), которая перебивала
    // настоящий GPS-фикс.
    // Примечание: на десктопах без GPS macOS/CoreLocation периодически пишет
    // в консоль «kCLErrorLocationUnknown». Это системный лог браузера, не JS-
    // ошибка. Мы фильтруем его в фильтре console (см. main.tsx / setupConsole).
    watchIdRef.current = navigator.geolocation.watchPosition(
      onSuccess,
      onError,
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30000,
      },
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [ready])

  // Периодически подгружаем последние координаты других райдеров
  useEffect(() => {
    if (!ready) return
    let alive = true

    const fetchOnce = async () => {
      try {
        const list = await apiListUserLocations(RIDERS_MAX_AGE_MIN)
        if (alive) setRiders(list)
      } catch {
        // Тихо: карта продолжает работать, просто без чужих меток.
      }
    }

    fetchOnce()
    const timer = window.setInterval(fetchOnce, LOCATION_POLL_INTERVAL_MS)

    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [ready])

  // Отрисовка / обновление маркеров других райдеров
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return

    const markers = riderMarkersRef.current
    const nextIds = new Set(riders.map((r) => r.id))

    // Удаляем «пропавших» райдеров.
    for (const [id, marker] of markers.entries()) {
      if (!nextIds.has(id)) {
        try {
          if (USE_YANDEX) {
            map.geoObjects.remove(marker)
          } else {
            marker.remove()
          }
        } catch {
          /* noop */
        }
        markers.delete(id)
      }
    }

    // Добавляем/обновляем актуальных.
    for (const r of riders) {
      const point: [number, number] = [r.lat, r.lng]
      const title = r.full_name || r.username
      const label = `${title} · @${r.username} · ${formatLastSeen(r.last_seen_at)}`

      const existing = markers.get(r.id)

      if (USE_YANDEX) {
        const ymaps = window.ymaps
        if (!ymaps) continue
        if (!existing) {
          const placemark = new ymaps.Placemark(
            point,
            {
              balloonContent: label,
              hintContent: title,
              iconContent: (title[0] || '?').toUpperCase(),
            },
            {
              preset: 'islands#blueCircleIcon',
              iconColor: '#2a6bff',
            },
          )
          map.geoObjects.add(placemark)
          markers.set(r.id, placemark)
        } else {
          existing.geometry.setCoordinates(point)
          existing.properties.set({
            balloonContent: label,
            hintContent: title,
            iconContent: (title[0] || '?').toUpperCase(),
          })
        }
      } else {
        const L = window.L
        if (!L) continue
        if (!existing) {
          const marker = L.circleMarker(point, {
            radius: 7,
            color: '#2a6bff',
            weight: 2,
            fillColor: '#2a6bff',
            fillOpacity: 0.85,
          })
            .addTo(map)
            .bindTooltip(label, { direction: 'top', offset: [0, -6] })
            .bindPopup(label)
          markers.set(r.id, marker)
        } else {
          existing.setLatLng(point)
          existing.setTooltipContent(label)
          existing.setPopupContent(label)
        }
      }
    }
  }, [riders, ready])

  const centerOnMe = () => {
    const map = mapRef.current
    if (!map || !coords) return
    const point: [number, number] = [coords.lat, coords.lng]
    if (USE_YANDEX) {
      map.setCenter(point, Math.max(map.getZoom(), MY_ZOOM), { duration: 400 })
    } else {
      map.setView(point, Math.max(map.getZoom(), MY_ZOOM), { animate: true })
    }
  }

  return (
    <div className="map-page">
      <div className="map-page__head">
        <div>
          <h1 className="map-page__title">Карта</h1>
          <p className="map-page__sub">
            {error
              ? error
              : coords
              ? `Ваши координаты: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(
                  5,
                )}  ·  точность ±${Math.round(coords.accuracy)} м  ·  на карте ${riders.length} райдер(ов)`
              : status}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={centerOnMe}
          disabled={!coords}
        >
          Я здесь
        </button>
      </div>

      <div className="map-wrap">
        <div ref={mapContainerRef} className="map-canvas" />
      </div>
    </div>
  )
}
