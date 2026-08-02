import { type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const location = useLocation()

  const initial = (user?.username?.[0] || '?').toUpperCase()

  // На главной странице авторизованного пользователя показываем только
  // «прибор-пейджер» — без верхней шапки-навигации: весь функционал уже
  // разложен по кнопкам пейджера, а лишний header ломает визуал макета.
  const hideHeader = user != null && location.pathname === '/'

  return (
    <div className={`app-shell${hideHeader ? ' app-shell--no-header' : ''}`}>
      {!hideHeader && (
      <header className="site-header">

        <div className="container header-inner">
          <Link to="/" className="logo" aria-label="MOTO39">
            <img
              src="/logo.jpeg"
              alt=""
              className="logo-img"
              width={40}
              height={40}
              decoding="async"
            />
            <span className="logo-text">MOTO39</span>
          </Link>

          <nav className="nav">
            {user ? (
              <>
               
                {user.is_superuser && (
                  <NavLink to="/admin" className="nav-link" title="Админка">
                    ⚙️ Админ
                  </NavLink>
                )}
                <Link to="/cabinet" className="nav-user" title="Профиль">
                  {user.avatar_url ? (
                    <span className="nav-user__avatar nav-user__avatar--image">
                      <img src={user.avatar_url} alt={user.username} />
                    </span>
                  ) : (
                    <span className="nav-user__avatar">{initial}</span>
                  )}
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
      )}

      <main className="main">
        <div className="container">{children}</div>
      </main>

      {!hideHeader && (
        <footer className="site-footer">
          <div className="container">MOTO39</div>
        </footer>
      )}
    </div>
  )
}
