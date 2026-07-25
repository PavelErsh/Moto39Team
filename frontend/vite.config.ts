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
    // basicSsl подсунет самоподписанный сертификат; типы Vite не принимают
    // просто `true`, поэтому передаём пустой объект (эквивалентно `true`).
    https: {},
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
  build: {
    // Целимся в широкий список браузеров, включая старые Android/iOS.
    // esbuild сам знает эти таргеты и подберёт совместимый output.
    target: ['es2019', 'chrome80', 'safari13', 'firefox78'],
    // Разбиваем вендорные библиотеки на отдельные чанки, чтобы:
    // 1) страницы, где они не нужны, вообще их не грузили;
    // 2) браузер мог кешировать вендорные чанки между релизами.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          twemoji: ['@twemoji/api'],
          axios: ['axios'],
        },
      },
    },
    // Для слабых устройств важнее размер, чем скорость сборки.
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: false,
  },
})
