import { Link } from 'react-router-dom'

type Props = {
  title: string
  icon: string
  description?: string
}

export default function StubPage({ title, icon, description }: Props) {
  return (
    <div className="stub">
      <div className="stub__icon">{icon}</div>
      <h1 className="stub__title">{title}</h1>
      <p className="stub__desc">{description ?? 'Скоро здесь будет.'}</p>
      <Link to="/" className="btn btn-ghost btn-lg">
        На главную
      </Link>
    </div>
  )
}
