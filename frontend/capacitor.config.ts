import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Конфигурация Capacitor-приложения MOTO39.
 *
 * ВАЖНО: `server.url` НЕ задаём для production-сборки — в этом случае
 * Capacitor подгружает статику из папки `webDir` (собранный React), а API
 * ходит по абсолютному URL (см. VITE_API_URL / VITE_API_ORIGIN).
 *
 * Если для отладки нужно грузить страницу с dev-сервера Vite напрямую
 * с телефона, раскомментируйте `server.url` и укажите свой IP.
 */
const config: CapacitorConfig = {
  appId: 'ru.moto39team.app',
  appName: 'MOTO39',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    // url: 'https://192.168.0.10:5173', // для локальной разработки
    // cleartext: true,
  },
  plugins: {
    // Настройки штатного плагина геолокации (foreground) — оставим по умолчанию.
    Geolocation: {},
    // Плагин фоновой геолокации: показывает системное уведомление,
    // чтобы Android держал foreground-service и не убивал приложение.
    BackgroundGeolocation: {
      // Название/описание/иконка задаются при старте watcher-а
      // (см. src/services/backgroundLocation.ts).
    },
  },
}

export default config
