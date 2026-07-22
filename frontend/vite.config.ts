import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
//
// HTTPS обязателен, чтобы мобильный браузер отдал реальные GPS-координаты
// через Geolocation API. На http (кроме localhost) браузер блокирует API
// или возвращает грубую позицию по IP.
//
// Дополнительно проксируем /api на локальный бэкенд FastAPI (порт 8000),
// чтобы клиент мог обращаться к API по тому же HTTPS-адресу без mixed content.
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true, // 0.0.0.0 — доступно с телефона в той же Wi-Fi сети
    port: 5173,
    https: true,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      // Прокси на загруженные файлы (изображения статей мотосправки и т.п.)
      '/media': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
