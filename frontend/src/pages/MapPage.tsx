import { useEffect, useRef, useState } from 'react'
import {
  apiListUserLocations,
  type UserLocation,
} from '../api/motorcycles'
import {
  getLastFix,
  startBackgroundLocation,
  subscribeLocation,
  type LocationFix,
} from '../services/backgroundLocation'
import InstallPwaHint from '../components/InstallPwaHint'
import { useAuth } from '../context/AuthContext'


// Калининград — центр по умолчанию
const DEFAULT_CENTER: [number, number] = [54.7104, 20.4522]
const DEFAULT_ZOOM = 11
const MY_ZOOM = 15

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

// Список CDN для Leaflet. Пробуем по очереди — если один недоступен
// (например, unpkg.com блокируется прокси / Яндекс.Турбо, или падает
// SRI-проверка при проксировании), переключаемся на следующий.
// Важно: SRI (integrity) НЕ используем — в режиме Турбо Яндекс.Браузер
// проксирует статику через свои сервера, из-за чего хеш не совпадает
// и браузер блокирует скрипт/стиль. Именно это ломало карту.
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
  // На всякий случай снимаем старые CSS-теги, чтобы не тянуть заблокированные
  document
    .querySelectorAll('link[data-leaflet="1"]')
    .forEach((el) => el.parentNode?.removeChild(el))
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
        // Пробуем следующий CDN
        continue
      }
    }
    throw new Error(
      (lastErr as Error)?.message ||
        'Не удалось загрузить карту (Leaflet). Проверьте интернет ' +
          'или отключите режим «Турбо» в Яндекс.Браузере.',
    )
  })()

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

/* ------------------------ Стили меток по свежести ----------------------- */
//
// Правила окраски маркеров райдеров на карте (см. ТЗ):
//   • «в сети» (координаты обновлялись < 2 мин назад)   — зелёная;
//   • до 15 минут                                       — жёлтая;
//   • 15–60 минут                                       — красная;
//   • более 60 минут                                    — полая (чёрный
//     контур, белая заливка);
//   • собственный маркер пользователя                    — красная с
//     белыми краями.
type MarkerStyle = {
  /** Цвет обводки. */
  border: string
  /** Цвет заливки. */
  fill: string
  /** Название пресета Яндекс.Карт для аналогичного визуального стиля. */
  yandexPreset: string
  /** Цвет иконки Яндекс.Карт (используется вместе с пресетом). */
  yandexIconColor: string
}

// Порог «в сети», минут. Немного больше интервала опроса чужих
// координат (30 сек), чтобы метка не мигала между «зелёной» и «жёлтой».
const ONLINE_THRESHOLD_MIN = 2

const STYLE_ONLINE: MarkerStyle = {
  border: '#16a34a',
  fill: '#22c55e',
  yandexPreset: 'islands#greenCircleDotIcon',
  yandexIconColor: '#22c55e',
}
const STYLE_15MIN: MarkerStyle = {
  border: '#ca8a04',
  fill: '#eab308',
  yandexPreset: 'islands#yellowCircleDotIcon',
  yandexIconColor: '#eab308',
}
const STYLE_60MIN: MarkerStyle = {
  border: '#b91c1c',
  fill: '#ef4444',
  yandexPreset: 'islands#redCircleDotIcon',
  yandexIconColor: '#ef4444',
}
const STYLE_STALE: MarkerStyle = {
  border: '#000000',
  fill: '#ffffff',
  // «Полая» метка: у Яндекса нет прямого пресета, используем светлую
  // с белым цветом иконки — визуально это самый близкий аналог.
  yandexPreset: 'islands#circleIcon',
  yandexIconColor: '#ffffff',
}
const STYLE_ME: MarkerStyle = {
  // Собственный маркер — красная точка в белой обводке.
  border: '#ffffff',
  fill: '#ef4444',
  yandexPreset: 'islands#redCircleDotIcon',
  yandexIconColor: '#ef4444',
}

// Стили для экстренных статусов (SOS / HELP) — переопределяют обычную
// раскраску по свежести координат, чтобы выделить райдера на карте.
// Для Яндекс.Карт используем «stretchy»-пресеты: их корпус
// автоматически расширяется под iconContent, поэтому крупный текст
// «SOS» / «HELP» виден прямо на метке БЕЗ необходимости наводить курсор
// или открывать балун.
const STYLE_HELP: MarkerStyle = {
  border: '#ca8a04',
  fill: '#facc15',
  yandexPreset: 'islands#yellowStretchyIcon',
  yandexIconColor: '#facc15',
}
const STYLE_SOS: MarkerStyle = {
  border: '#b91c1c',
  fill: '#ef4444',
  yandexPreset: 'islands#redStretchyIcon',
  yandexIconColor: '#ef4444',
}


function styleForRider(lastSeenIso: string): MarkerStyle {
  const diffMin =
    (Date.now() - new Date(lastSeenIso).getTime()) / 60_000
  if (!Number.isFinite(diffMin) || diffMin < ONLINE_THRESHOLD_MIN) {
    return STYLE_ONLINE
  }
  if (diffMin < 15) return STYLE_15MIN
  if (diffMin < 60) return STYLE_60MIN
  return STYLE_STALE
}

/* ------------------------------ Компонент ------------------------------ */

export default function MapPage() {
  const { user } = useAuth()
  // Собственный экстренный статус: перекрашивает мой маркер в цвет
  // соответствующей категории (SOS — красный, HELP — жёлтый) и
  // показывает постоянную подпись над меткой, чтобы автор точно видел,
  // что его сигнал зафиксирован.
  const myEmergency: 'help' | 'sos' | null =
    user?.emergency_status === 'help'
      ? 'help'
      : user?.emergency_status === 'sos'
        ? 'sos'
        : null

  // Ref для актуального значения myEmergency — используется внутри
  // callback'а applyFix, у которого иначе будет stale closure на
  // первоначальное значение из момента подписки. Без этого ref после
  // нажатия SOS/HELP при следующем GPS-фиксе маркер перекрашивался
  // бы обратно в обычный стиль.
  const myEmergencyRef = useRef<'help' | 'sos' | null>(myEmergency)
  useEffect(() => {
    myEmergencyRef.current = myEmergency
  }, [myEmergency])

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const meMarkerRef = useRef<any>(null)
  const accuracyCircleRef = useRef<any>(null)
  const firstFixAppliedRef = useRef(false)


  // Отдельная коллекция маркеров других райдеров: userId -> marker
  const riderMarkersRef = useRef<Map<number, any>>(new Map())

  const [, setStatus] = useState<string>('Загружаем карту…')
  const [coords, setCoords] = useState<{
    lat: number
    lng: number
    accuracy: number | null
  } | null>(() => {
    // Если фоновый сервис уже что-то поймал раньше — сразу используем.
    const cached = getLastFix()
    if (!cached) return null
    return { lat: cached.lat, lng: cached.lng, accuracy: cached.accuracy }
  })

  const [, setError] = useState<string | null>(null)
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

  // Подписка на глобальный трекер геолокации (общий сервис).
  //
  // Мы НЕ запускаем свой `watchPosition` — сервис `backgroundLocation`
  // уже отслеживает позицию с момента логина (независимо от того, на
  // какой странице находится пользователь). Здесь только рисуем на карте.
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return

    // На всякий случай пытаемся стартануть — если сервис уже запущен,
    // это no-op. Полезно, если карта открыта до срабатывания эффекта в
    // AuthContext (например, при первом рендере).
    void startBackgroundLocation()

    const applyFix = (fix: LocationFix) => {
      const { lat, lng, accuracy } = fix
      const point: [number, number] = [lat, lng]

      setCoords({ lat, lng, accuracy })
      setError(null)
      setStatus('')

      // Радиус погрешности рисуем, только если ОС его сообщила.
      const radius = typeof accuracy === 'number' && accuracy > 0 ? accuracy : 0

      // Стиль собственной метки зависит от активного emergency-статуса.
      // Читаем через ref, а НЕ из замыкания (иначе после нажатия
      // SOS/HELP при следующем GPS-фиксе метка перекрасится обратно
      // в обычный «Вы здесь», т.к. подписка была создана с прошлым
      // значением myEmergency).
      const emergencyNow = myEmergencyRef.current
      const myStyle: MarkerStyle =
        emergencyNow === 'sos'
          ? STYLE_SOS
          : emergencyNow === 'help'
            ? STYLE_HELP
            : STYLE_ME
      const myBadge =
        emergencyNow === 'sos'
          ? 'SOS'
          : emergencyNow === 'help'
            ? 'HELP'
            : null
      const myTooltip = myBadge ? `${myBadge} · Вы здесь` : 'Вы здесь'

      if (USE_YANDEX) {
        const ymaps = window.ymaps
        if (!ymaps) return

        if (!meMarkerRef.current) {
          meMarkerRef.current = new ymaps.Placemark(
            point,
            {
              balloonContent: myTooltip,
              hintContent: myTooltip,
              iconContent: myBadge || undefined,
            },
            {
              preset: myStyle.yandexPreset,
              iconColor: myStyle.yandexIconColor,
            },
          )
          map.geoObjects.add(meMarkerRef.current)
        } else {
          meMarkerRef.current.geometry.setCoordinates(point)
          meMarkerRef.current.properties.set({
            balloonContent: myTooltip,
            hintContent: myTooltip,
            iconContent: myBadge || undefined,
          })
          meMarkerRef.current.options.set({
            preset: myStyle.yandexPreset,
            iconColor: myStyle.yandexIconColor,
          })
        }

        if (radius > 0) {
          if (!accuracyCircleRef.current) {
            accuracyCircleRef.current = new ymaps.Circle(
              [point, radius],
              {},
              {
                fillColor: `${myStyle.fill}22`,
                strokeColor: myStyle.fill,
                strokeOpacity: 0.7,
                strokeWidth: 1,
              },
            )
            map.geoObjects.add(accuracyCircleRef.current)
          } else {
            accuracyCircleRef.current.geometry.setCoordinates(point)
            accuracyCircleRef.current.geometry.setRadius(radius)
            accuracyCircleRef.current.options.set({
              fillColor: `${myStyle.fill}22`,
              strokeColor: myStyle.fill,
            })
          }
        }

        if (!firstFixAppliedRef.current) {
          map.setCenter(point, MY_ZOOM, { duration: 400 })
          firstFixAppliedRef.current = true
        }
      } else {
        const L = window.L
        if (!L) return

        const meOpts = {
          radius: 8,
          color: myStyle.border,
          weight: 3,
          fillColor: myStyle.fill,
          fillOpacity: 1,
        }

        if (!meMarkerRef.current) {
          // По ТЗ: собственный маркер — красный с белой обводкой в обычном
          // режиме. При активном SOS/HELP перекрашиваем в цвет статуса
          // и показываем постоянную подпись над меткой.
          meMarkerRef.current = L.circleMarker(point, meOpts).addTo(map)
          if (myBadge) {
            meMarkerRef.current.bindTooltip(myTooltip, {
              direction: 'top',
              offset: [0, -8],
              permanent: true,
              className: 'map-emergency-badge',
            })
          } else {
            meMarkerRef.current.bindTooltip(myTooltip, {
              direction: 'top',
              offset: [0, -6],
            })
          }
        } else {
          meMarkerRef.current.setLatLng(point)
          meMarkerRef.current.setStyle(meOpts)
          // Полностью пересобираем tooltip, т.к. permanent-режим
          // приходится менять при смене статуса.
          try {
            meMarkerRef.current.unbindTooltip()
          } catch {
            /* noop */
          }
          if (myBadge) {
            meMarkerRef.current.bindTooltip(myTooltip, {
              direction: 'top',
              offset: [0, -8],
              permanent: true,
              className: 'map-emergency-badge',
            })
          } else {
            meMarkerRef.current.bindTooltip(myTooltip, {
              direction: 'top',
              offset: [0, -6],
            })
          }
        }

        if (radius > 0) {
          if (!accuracyCircleRef.current) {
            accuracyCircleRef.current = L.circle(point, {
              radius,
              color: myStyle.fill,
              weight: 1,
              opacity: 0.7,
              fillColor: myStyle.fill,
              fillOpacity: 0.13,
            }).addTo(map)
          } else {
            accuracyCircleRef.current.setLatLng(point)
            accuracyCircleRef.current.setRadius(radius)
            accuracyCircleRef.current.setStyle({
              color: myStyle.fill,
              fillColor: myStyle.fill,
            })
          }
        }

        if (!firstFixAppliedRef.current) {
          map.setView(point, Math.max(map.getZoom(), MY_ZOOM), {
            animate: true,
          })
          firstFixAppliedRef.current = true
        }
      }
    }


    setStatus('Ждём GPS…')
    const unsubscribe = subscribeLocation(applyFix)

    return () => {
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // При смене собственного emergency-статуса — мгновенно перекрашиваем
  // уже отрисованный собственный маркер и его circle погрешности, не
  // дожидаясь следующего GPS-фикса. Иначе после нажатия SOS/HELP пользователь
  // видел бы обновление цвета только через полминуты (когда придёт fix).
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    const meMarker = meMarkerRef.current
    if (!map || !meMarker) return

    const myStyle: MarkerStyle =
      myEmergency === 'sos'
        ? STYLE_SOS
        : myEmergency === 'help'
          ? STYLE_HELP
          : STYLE_ME
    const myBadge =
      myEmergency === 'sos' ? 'SOS' : myEmergency === 'help' ? 'HELP' : null
    const myTooltip = myBadge ? `${myBadge} · Вы здесь` : 'Вы здесь'

    if (USE_YANDEX) {
      try {
        meMarker.properties.set({
          balloonContent: myTooltip,
          hintContent: myTooltip,
          iconContent: myBadge || undefined,
        })
        meMarker.options.set({
          preset: myStyle.yandexPreset,
          iconColor: myStyle.yandexIconColor,
        })
      } catch {
        /* noop */
      }
      if (accuracyCircleRef.current) {
        try {
          accuracyCircleRef.current.options.set({
            fillColor: `${myStyle.fill}22`,
            strokeColor: myStyle.fill,
          })
        } catch {
          /* noop */
        }
      }
    } else {
      try {
        meMarker.setStyle({
          color: myStyle.border,
          fillColor: myStyle.fill,
          weight: 3,
          fillOpacity: 1,
        })
        try {
          meMarker.unbindTooltip()
        } catch {
          /* noop */
        }
        if (myBadge) {
          meMarker.bindTooltip(myTooltip, {
            direction: 'top',
            offset: [0, -8],
            permanent: true,
            className: 'map-emergency-badge',
          })
        } else {
          meMarker.bindTooltip(myTooltip, {
            direction: 'top',
            offset: [0, -6],
          })
        }
      } catch {
        /* noop */
      }
      if (accuracyCircleRef.current) {
        try {
          accuracyCircleRef.current.setStyle({
            color: myStyle.fill,
            fillColor: myStyle.fill,
          })
        } catch {
          /* noop */
        }
      }
    }
  }, [myEmergency, ready])


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
      // Подпись для экстренных статусов
      const badge =
        r.emergency_status === 'help'
          ? 'HELP'
          : r.emergency_status === 'sos'
            ? 'SOS'
            : null
      const label = (badge ? `[${badge}] ` : '') + `${title} · @${r.username} · ${formatLastSeen(r.last_seen_at)}`
      // Цвет метки зависит от времени последнего обновления координат.
      // Экстренные статусы (help/sos) переопределяют стандартную раскраску.
      let style: MarkerStyle
      if (r.emergency_status === 'help') {
        style = STYLE_HELP
      } else if (r.emergency_status === 'sos') {
        style = STYLE_SOS
      } else {
        style = styleForRider(r.last_seen_at)
      }

      const existing = markers.get(r.id)

      if (USE_YANDEX) {
        const ymaps = window.ymaps
        if (!ymaps) continue
        if (!existing) {
          const placemark = new ymaps.Placemark(
            point,
            {
              balloonContent: label,
              hintContent: badge ? `[${badge}] ${title}` : title,
              iconContent: badge || (title[0] || '?').toUpperCase(),
            },
            {
              preset: style.yandexPreset,
              iconColor: style.yandexIconColor,
            },
          )
          map.geoObjects.add(placemark)
          markers.set(r.id, placemark)
        } else {
          existing.geometry.setCoordinates(point)
          existing.properties.set({
            balloonContent: label,
            hintContent: badge ? `[${badge}] ${title}` : title,
            iconContent: badge || (title[0] || '?').toUpperCase(),
          })
          // Обновляем визуальный стиль на случай, если категория «свежести»
          // сменилась с предыдущего опроса (например, райдер ушёл в оффлайн).
          existing.options.set({
            preset: style.yandexPreset,
            iconColor: style.yandexIconColor,
          })
        }
      } else {
        const L = window.L
        if (!L) continue
        // Опции цвета/заливки Leaflet-круга для конкретной категории.
        const leafletOpts = {
          radius: 7,
          color: style.border,
          weight: 2,
          fillColor: style.fill,
          // «Полая» метка (более 60 минут) — прозрачная заливка не нужна:
          // достаточно белого цвета, но чтобы её было хорошо видно на
          // светлых участках карты, оставляем непрозрачную заливку.
          fillOpacity: style === STYLE_STALE ? 1 : 0.85,
        }
        if (!existing) {
          const marker = L.circleMarker(point, leafletOpts).addTo(map)
          // Экстренные метки получают постоянный «badge» с крупной
          // подписью SOS/HELP над точкой — так на карте сразу видно,
          // кому нужна помощь, без необходимости наводить курсор.
          if (badge) {
            marker.bindTooltip(badge, {
              direction: 'top',
              offset: [0, -8],
              permanent: true,
              className: `map-emergency-badge map-emergency-badge--${badge.toLowerCase()}`,
            })
          } else {
            marker.bindTooltip(label, {
              direction: 'top',
              offset: [0, -6],
            })
          }
          marker.bindPopup(label)
          markers.set(r.id, marker)
        } else {
          existing.setLatLng(point)
          existing.setStyle(leafletOpts)
          // Пересобираем tooltip: тип (permanent / hover) мог смениться,
          // если у райдера сменился emergency_status между опросами.
          try {
            existing.unbindTooltip()
          } catch {
            /* noop */
          }
          if (badge) {
            existing.bindTooltip(badge, {
              direction: 'top',
              offset: [0, -8],
              permanent: true,
              className: `map-emergency-badge map-emergency-badge--${badge.toLowerCase()}`,
            })
          } else {
            existing.bindTooltip(label, {
              direction: 'top',
              offset: [0, -6],
            })
          }
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
      <InstallPwaHint />
      <div className="map-page__head">
        <div>
          <h1 className="map-page__title">Мотокарта</h1>
        </div>

        {/*
          Легенда точек и кнопка «Я здесь» вынесены в правую часть
          шапки — визуально они на одной горизонтальной линии.
          На узких экранах эта колонка переносится на новую строку
          благодаря `flex-wrap: wrap` у `.map-page__head`.
        */}
        <div className="map-page__controls">
          <ul
            className="map-legend"
            aria-label="Расшифровка точек на карте"
          >
            <li className="map-legend__item">
              <span
                className="map-legend__dot map-legend__dot--online"
                aria-hidden="true"
              />
              <span>В сети</span>
            </li>
            <li className="map-legend__item">
              <span
                className="map-legend__dot map-legend__dot--recent"
                aria-hidden="true"
              />
              <span>До 15 минут назад</span>
            </li>
            <li className="map-legend__item">
              <span
                className="map-legend__dot map-legend__dot--away"
                aria-hidden="true"
              />
              <span>15–60 минут назад</span>
            </li>
            <li className="map-legend__item">
              <span
                className="map-legend__dot map-legend__dot--stale"
                aria-hidden="true"
              />
              <span>Более 60 минут назад</span>
            </li>
          </ul>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={centerOnMe}
            disabled={!coords}
          >
            Я здесь
          </button>
        </div>
      </div>

      <div className="map-wrap">
        <div ref={mapContainerRef} className="map-canvas" />
      </div>
    </div>
  )
}
