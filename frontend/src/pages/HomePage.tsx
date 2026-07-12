import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type Tile = {
  to: string
  title: string
  icon: string
}

const TILES: Tile[] = [
  { to: '/moto', title: 'Гараж', icon: '🏍' },
  { to: '/riders', title: 'Райдеры', icon: '👥' },
  { to: '/rides', title: 'Заезды', icon: '🏁' },
  { to: '/calendar', title: 'Календарь', icon: '📅' },
  { to: '/map', title: 'Карта', icon: '🗺' },
]

export default function HomePage() {
  const { user } = useAuth()

  if (!user) {
    return (
      <div className="home">
        <section className="hero">
          <div className="hero__moto">🏍</div>
          <p className="hero__lead">
            Один руль — одна дорога.
            <br />
            Вступай, чтобы попасть в гараж, к заездам и в общий чат.
          </p>

          <div className="hero__cta">
            <Link to="/register" className="btn btn-primary btn-lg">
              Вступить
            </Link>
            <Link to="/login" className="btn btn-ghost btn-lg">
              Войти
            </Link>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="home">
      <section className="hero">
        <div className="hero__moto">🏍</div>
        <p className="hero__lead">
          Добро пожаловать, {user.full_name || user.username}
        </p>
      </section>

      <Link to="/chat" className="chat-btn">
        Общий чат
      </Link>

      <nav className="tiles">
        {TILES.map((t) => (
          <Link key={t.to} to={t.to} className="tile">
            <span className="tile__icon">{t.icon}</span>
            <span className="tile__title">{t.title}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
