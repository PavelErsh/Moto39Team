import { type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()

  const initial = (user?.username?.[0] || '?').toUpperCase()

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="logo">
            <span className="logo-mark">🏍</span>
            <span className="logo-text">Мотобратство</span>
          </Link>

          <nav className="nav">
            {user ? (
              <>
                {user.is_superuser && (
                  <NavLink to="/admin" className="nav-link" title="Админка">
                    ⚙ Админ
                  </NavLink>
                )}
                <Link to="/cabinet" className="nav-user" title="Профиль">
                  <span className="nav-user__avatar">{initial}</span>
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={logout}
                >
                  Выйти
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className="nav-link">
                  Войти
                </NavLink>
                <Link to="/register" className="btn btn-primary btn-sm">
                  Вступить
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="main">
        <div className="container">{children}</div>
      </main>

      <footer className="site-footer">
        <div className="container">Мотобратство</div>
      </footer>
    </div>
  )
}
