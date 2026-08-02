import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiUpdateEmergencyStatus } from '../api/motorcycles'

/**
 * Стартовая страница — «мото-пейджер».
 *
 * Реализация: сама картинка пейджера (`/pager.jpeg`) используется как
 * фоновое изображение с фиксированным соотношением сторон. Поверх неё
 * абсолютным позиционированием (в процентах от контейнера) раскладываются
 * прозрачные кликабельные зоны — так на любом устройстве кнопки точно
 * попадают в свои места на картинке.
 *
 * Такой подход выбран сознательно (вместо CSS-репликации всех кнопок),
 * чтобы визуально страница была 1-в-1 с макетом.
 *
 * Назначение кнопок (согласовано с макетом):
 *   • Аватар (левый верхний угол экрана) — профиль пользователя (/cabinet)
 *   • Шестерёнка (правый верхний угол экрана) — настройки (кабинет/админка)
 *   • МОТОКАРТА — карта с пользователями (/map)
 *   • ДОНАТ — справка «Донат»
 *   • Я КАТАЮ — Telegram-чат moto39 (конкретный пост)
 *   • SOS — Telegram-чат moto39
 *   • ВЫХОД — logout
 *   • HELP — конкретный пост Telegram (тот же, что и SOS)
 *   • ГАРАЖ — мотоциклы пользователя (/moto)
 *   • РАЙДЕРЫ — все пользователи (/riders)
 *   • МОТОКАЛЕНДАРЬ — календарь событий (/calendar)
 *   • СОБЫТИЯ — раздел в разработке
 *   • МОТОСПРАВКА — справка по мото (/reference)
 *   • ОБЩИЙ ЧАТ — Telegram-чат moto39
 *   • БАЙКЧАТ — раздел в разработке
 */

// URL telegram-чата, на который ведут кнопки SOS / HELP / ОБЩИЙ ЧАТ.
const TG_CHAT_URL = 'https://t.me/mkld39'

// URL конкретного поста в telegram-чате для кнопки «Я КАТАЮ».
const TG_YA_KATAYU_URL = 'https://t.me/mkld39/1612'

// URL для кнопки SOS.
const TG_SOS_URL = 'https://t.me/mkld39/1611'

// Хиты — прямоугольники в процентах от размеров картинки-подложки.
// Значения подобраны по референсу `/pager.jpeg`.
//   top / left / width / height — в % относительно контейнера-подложки.
type Hit = {
  key: string
  label: string        // подпись — используется как aria-label
  top: string
  left: string
  width: string
  height: string
  round?: boolean      // круглые кнопки (Я КАТАЮ / SOS / HELP / аватар / шестерёнка)
}

/* eslint-disable no-multi-spaces */
const HITS: Record<string, Hit> = {
  // Верх экрана пейджера
  avatar:   { key: 'avatar',   label: 'Профиль',        top: '16%', left: '9.5%', width: '12.5%',   height: '5.8%',  round: true },
  gear:     { key: 'gear',     label: 'Настройки',      top: '16%', left: '79.5%', width: '12.5%',   height: '5.6%',  round: true },

  // «Мотокарта» — зелёная кнопка внизу экрана
  motoMap:  { key: 'motoMap',  label: 'Мотокарта',      top: '38.5%', left: '30%',   width: '40%',   height: '4.6%' },

  // Верхний ряд под экраном: ДОНАТ / Я КАТАЮ (круг) / SOS (круг) / ВЫХОД
  donat:    { key: 'donat',    label: 'Донат',          top: '48.2%', left: '4%',  width: '16%',   height: '4.0%' },
  yakat:    { key: 'yakat',    label: 'Я катаю',        top: '49.4%', left: '28.5%', width: '17%',   height: '8.3%',  round: true },
  sos:      { key: 'sos',      label: 'SOS',            top: '47.4%', left: '52%',   width: '16%',   height: '7.8%',  round: true },
  exit:     { key: 'exit',     label: 'Выход',          top: '47.2%', left: '79.5%',   width: '18%',   height: '4.4%' },

  // HELP — оранжевая круглая, ниже SOS
  help:     { key: 'help',     label: 'HELP',           top: '56.6%', left: '54%',   width: '14%',   height: '6.4%',  round: true },

  // Левая колонка кнопок
  garaj:    { key: 'garaj',    label: 'Гараж',          top: '60.1%', left: '27.8%',  width: '18%',   height: '4.4%' },
  rider:    { key: 'rider',    label: 'Райдеры',        top: '65.5%', left: '27.8%',  width: '18%',   height: '4.4%' },
  kaln:     { key: 'kaln',     label: 'Мотокалендарь',  top: '71.5%', left: '27.8%',  width: '18%',   height: '3.2%' },
  sob:      { key: 'sob',      label: 'События',        top: '77.3%', left: '27.8%',  width: '18%',   height: '3.4%' },
  sprav:    { key: 'sprav',    label: 'Мотосправка',    top: '83.4%', left: '27.8%',  width: '18%',   height: '3.2%' },

  // Правая колонка — большие «tall» кнопки
  obchat:   { key: 'obchat',   label: 'Общий чат',      top: '65.7%', left: '55%',   width: '19%',   height: '5.6%' },
  baik:     { key: 'baik',     label: 'Байкчат',        top: '75.2%', left: '55%',   width: '19%',   height: '5.4%' },
}
/* eslint-enable no-multi-spaces */

export default function HomePage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  // Гостевая версия — экран приветствия с приглашением войти/вступить.
  // «Прибор-пейджер» показывается ТОЛЬКО авторизованным пользователям.
  if (!user) {
    return (
      <div className="home">
        <section className="hero">
          <div className="hero__moto">🏍️</div>
          <h1 className="hero__title">MOTO39</h1>
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

  // Хелпер для стилей хит-зоны
  const hitStyle = (h: Hit): React.CSSProperties => ({
    position: 'absolute',
    top: h.top,
    left: h.left,
    width: h.width,
    height: h.height,
    borderRadius: h.round ? '50%' : '10px',
  })

  // Открыть Telegram-чат moto39 в новой вкладке.
  const openTgChat = () => {
    window.open(TG_CHAT_URL, '_blank', 'noopener,noreferrer')
  }

  // Открыть конкретный пост «Я КАТАЮ» в telegram-чате.
  const openYaKatayu = () => {
    window.open(TG_YA_KATAYU_URL, '_blank', 'noopener,noreferrer')
  }

  // Открыть пост SOS/HELP — с подтверждением, что ситуация срочная.
  // После подтверждения устанавливает emergency_status на бэке (меняет
  // вид маркера на карте: help → жёлтая точка, sos → красная точка).
  const openSosHelp = async (type: 'help' | 'sos') => {
    const confirmed = window.confirm(
      '⚠️ Эти кнопки для чрезвычайных ситуаций.\n' +
      'В случае отправки ложных сообщений к вам могут быть применены меры вплоть до блокировки.\n\n' +
      'Нажмите «ОК» — если ситуация срочная,\n' +
      '«Отмена» — если нажали случайно.',
    )
    if (confirmed) {
      try {
        await apiUpdateEmergencyStatus(type)
      } catch {
        // Тихо игнорируем — главное открыть чат
      }
      window.open(TG_SOS_URL, '_blank', 'noopener,noreferrer')
    }
  }

  // Кнопка "Выход" — logout авторизованного пользователя.
  const handleExit = () => {
    logout()
    navigate('/')
  }

  // Профиль / настройки — для авторизованного всегда есть куда идти.
  const profileHref = '/cabinet'
  const gearHref = user.is_superuser ? '/admin' : '/cabinet'

  return (
    <div className="pager-bg">
      <div className="pager-bg__inner">
        {/* Сам пейджер — img, чтобы браузер держал соотношение сторон. */}
        <img
          src="/pager.jpeg"
          alt=""
          aria-hidden="true"
          className="pager-bg__img"
        />

        {/* Аватар пользователя — накладывается поверх «нарисованного» в углу экрана. */}
        {user?.avatar_url && (
          <img
            src={user.avatar_url}
            alt={user.username}
            className="pager-bg__avatar"
            style={{
              top: '13.9%',
              left: '10.8%',
              width: '13.4%',
              height: '6.1%',
            }}
          />
        )}

        {/* ================= Кликабельные зоны ================= */}

        {/* Профиль пользователя (аватар в углу экрана) */}
        <Link
          to={profileHref}
          aria-label={HITS.avatar.label}
          className="pager-hit"
          style={hitStyle(HITS.avatar)}
        />

        {/* Настройки (шестерёнка) */}
        <Link
          to={gearHref}
          aria-label={HITS.gear.label}
          className="pager-hit"
          style={hitStyle(HITS.gear)}
        />

        {/* Мотокарта */}
        <Link
          to="/map"
          aria-label={HITS.motoMap.label}
          className="pager-hit"
          style={hitStyle(HITS.motoMap)}
        />

        {/* ДОНАТ */}
        <button
          type="button"
          aria-label={HITS.donat.label}
          className="pager-hit"
          style={hitStyle(HITS.donat)}
          onClick={() => navigate('/reference/donate')}
        />

        {/* Я КАТАЮ — конкретный пост Telegram */}
        <button
          type="button"
          aria-label={HITS.yakat.label}
          className="pager-hit"
          style={hitStyle(HITS.yakat)}
          onClick={openYaKatayu}
        />

        {/* SOS — конкретный пост Telegram (с подтверждением) */}
        <button
          type="button"
          aria-label={HITS.sos.label}
          className="pager-hit"
          style={hitStyle(HITS.sos)}
          onClick={() => openSosHelp('sos')}
        />

        {/* Выход */}
        <button
          type="button"
          aria-label={HITS.exit.label}
          className="pager-hit"
          style={hitStyle(HITS.exit)}
          onClick={handleExit}
        />

        {/* HELP — тот же пост, что и SOS (с подтверждением) */}
        <button
          type="button"
          aria-label={HITS.help.label}
          className="pager-hit"
          style={hitStyle(HITS.help)}
          onClick={() => openSosHelp('help')}
        />

        {/* Гараж */}
        <Link
          to="/moto"
          aria-label={HITS.garaj.label}
          className="pager-hit"
          style={hitStyle(HITS.garaj)}
        />

        {/* Райдеры */}
        <Link
          to="/riders"
          aria-label={HITS.rider.label}
          className="pager-hit"
          style={hitStyle(HITS.rider)}
        />

        {/* Мотокалендарь */}
        <Link
          to="/calendar"
          aria-label={HITS.kaln.label}
          className="pager-hit"
          style={hitStyle(HITS.kaln)}
        />

        {/* События — раздел в разработке */}
        <Link
          to="/rides"
          aria-label={HITS.sob.label}
          className="pager-hit"
          style={hitStyle(HITS.sob)}
        />

        {/* Мотосправка */}
        <Link
          to="/reference"
          aria-label={HITS.sprav.label}
          className="pager-hit"
          style={hitStyle(HITS.sprav)}
        />

        {/* Общий чат — Telegram-чат moto39 */}
        <button
          type="button"
          aria-label={HITS.obchat.label}
          className="pager-hit"
          style={hitStyle(HITS.obchat)}
          onClick={openTgChat}
        />

        {/* Байкчат — раздел в разработке */}
        <Link
          to="/chat"
          aria-label={HITS.baik.label}
          className="pager-hit"
          style={hitStyle(HITS.baik)}
        />
      </div>
    </div>
  )
}
