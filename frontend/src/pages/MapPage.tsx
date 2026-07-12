import { useEffect, useRef, useState } from 'react'

// Калининград — центр по умолчанию
const DEFAULT_CENTER: [number, number] = [54.7104, 20.4522]
const DEFAULT_ZOOM = 11
const MY_ZOOM = 15

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

  const [status, setStatus] = useState<string>('Загружаем карту…')
  const [coords, setCoords] = useState<{
    lat: number
    lng: number
    accuracy: number
  } | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

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
            attributionControl: true,
          })
          L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
              maxZoom: 19,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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

    const onSuccess: PositionCallback = (pos) => {
      const { latitude, longitude, accuracy } = pos.coords
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
              preset: 'islands#greenCircleDotIcon',
              iconColor: '#39ff14',
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
              fillColor: '#39ff1422',
              strokeColor: '#39ff14',
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
            color: '#39ff14',
            weight: 2,
            fillColor: '#39ff14',
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
            color: '#39ff14',
            weight: 1,
            opacity: 0.7,
            fillColor: '#39ff14',
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

    try {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, {
        enableHighAccuracy: false,
        maximumAge: 60000,
        timeout: 10000,
      })
    } catch {
      /* noop */
    }

    // Постоянный высокоточный трекинг GPS.
    // Примечание: на десктопах без GPS macOS/CoreLocation периодически пишет
    // в консоль «kCLErrorLocationUnknown». Это системный лог браузера, не JS-
    // ошибка. Мы фильтруем его в фильтре console (см. main.tsx / setupConsole).
    watchIdRef.current = navigator.geolocation.watchPosition(
      onSuccess,
      onError,
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000,
      },
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [ready])



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
                )}  ·  точность ±${Math.round(coords.accuracy)} м`
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
