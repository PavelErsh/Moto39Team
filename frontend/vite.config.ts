import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// HTTPS обязателен, чтобы мобильный браузер отдал реальные GPS-координаты
// через Geolocation API. На http (кроме localhost) браузер блокирует API
// или возвращает грубую позицию по IP.
//
// Дополнительно проксируем /api на локальный бэкенд FastAPI (порт 8000),
// чтобы клиент мог обращаться к API по тому же HTTPS-адресу без mixed content.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    // HTTPS временно отключён для локальной разработки чата (ws:// WebSocket).
    // basicSsl() будет возвращён после тестирования.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
        ws: true,  // WebSocket-прокси для чата
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
      // @capacitor/local-notifications доступен только в нативных сборках
      // (Android/iOS); при веб-сборке динамический import() падает.
      // external исключает модуль из бандла — catch в коде его перехватит.
      external: ['@capacitor/local-notifications'],
    },
    // Для слабых устройств важнее размер, чем скорость сборки.
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: false,
  },
})
