import { Link } from 'react-router-dom'
import LegalContent from '../components/LegalContent'

/**
 * Публичная страница `/legal` — полный текст пользовательского
 * соглашения и политики обработки персональных данных. Доступна
 * без авторизации: ссылку показываем в футере и в форме
 * регистрации.
 */
export default function LegalPage() {
  return (
    <section className="legal-page">
      <div className="legal-page__back">
        <Link to="/" className="btn btn-link">
          ← На главную
        </Link>
      </div>
      <article className="legal-page__card">
        <LegalContent />
      </article>
    </section>
  )
}
