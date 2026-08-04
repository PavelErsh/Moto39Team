import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import StubPage from './pages/StubPage'
import { useAuth } from './context/AuthContext'
import { useTwemoji } from './hooks/useTwemoji'

/**
 * Code-splitting крупных / редко используемых страниц.
 *
 * Даёт большой выигрыш на слабых устройствах: главный бандл становится
 * ощутимо меньше, парсинг/старт JS на первом экране быстрее, а карта
 * с её тяжёлыми зависимостями (Leaflet/Yandex, watchPosition) грузится
 * только тогда, когда пользователь реально идёт в /map.
 */
const CabinetPage = lazy(() => import('./pages/CabinetPage'))
const MapPage = lazy(() => import('./pages/MapPage'))
const GaragePage = lazy(() => import('./pages/GaragePage'))
const UserProfilePage = lazy(() => import('./pages/UserProfilePage'))
const RidersPage = lazy(() => import('./pages/RidersPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const EventsPage = lazy(() => import('./pages/EventsPage'))
const RideDetailPage = lazy(() => import('./pages/RideDetailPage'))
const EventDetailPage = lazy(() => import('./pages/EventDetailPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const ReferencesPage = lazy(() => import('./pages/ReferencesPage'))
const ReferenceDetailPage = lazy(() => import('./pages/ReferenceDetailPage'))

function PageFallback() {
  return (
    <div className="loading-screen">
      <div className="spinner" />
    </div>
  )
}

export default function App() {
  const { loading } = useAuth()
  useTwemoji()

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/cabinet"
            element={
              <ProtectedRoute>
                <CabinetPage />
              </ProtectedRoute>
            }
          />

          {/* Закрытые разделы — только для авторизованных */}
          <Route
            path="/moto"
            element={
              <ProtectedRoute>
                <GaragePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/riders"
            element={
              <ProtectedRoute>
                <RidersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/u/:username"
            element={
              <ProtectedRoute>
                <UserProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat"
            element={
              <StubPage
                icon="💬"
                title="Байкчат"
                description="В настоящее время ведутся работы по созданию своего чата для байкеров, не привязанного к Телеграмм и не требующего VPN и прокси. Одновременно с его созданием появится возможность эффективной коммуникации внутри приложения, например при нажатии на точку расположения райдера на мотокарте сразу написать ему в ЛС."
              />
            }
          />
          <Route
            path="/i-ride"
            element={
              <StubPage
                icon="🏍️"
                title="Я катаю"
                description="Раздел в разработке."
              />
            }
          />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/calendar/:id" element={<EventDetailPage />} />
          <Route path="/reference" element={<ReferencesPage />} />
          <Route path="/reference/:slug" element={<ReferenceDetailPage />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route path="/rides" element={<EventsPage />} />
          <Route path="/rides/:id" element={<RideDetailPage />} />
          <Route
            path="/map"
            element={
              <ProtectedRoute>
                <MapPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
