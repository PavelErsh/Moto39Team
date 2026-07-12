import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import CabinetPage from './pages/CabinetPage'
import StubPage from './pages/StubPage'
import MapPage from './pages/MapPage'
import GaragePage from './pages/GaragePage'
import UserProfilePage from './pages/UserProfilePage'
import RidersPage from './pages/RidersPage'
import CalendarPage from './pages/CalendarPage'
import AdminPage from './pages/AdminPage'
import { useAuth } from './context/AuthContext'

export default function App() {
  const { loading } = useAuth()

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <Layout>
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
            <ProtectedRoute>
              <StubPage icon="💬" title="Чат" />
            </ProtectedRoute>
          }
        />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/rides"
          element={
            <ProtectedRoute>
              <StubPage icon="🏁" title="Заезды" />
            </ProtectedRoute>
          }
        />
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
    </Layout>
  )
}
