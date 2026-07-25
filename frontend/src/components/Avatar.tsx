/**
 * Аватарка пользователя.
 *
 * Если у пользователя загружено фото (avatar_url), рисуем <img>.
 * Иначе — «инициал» на зелёной плашке в фирменной стилистике.
 */
interface AvatarProps {
  username: string
  avatarUrl?: string | null
  fullName?: string | null
  className?: string
  /** Дополнительный CSS-класс для контейнера. По умолчанию — `.avatar`. */
  size?: 'sm' | 'md' | 'lg'
  alt?: string
}

export default function Avatar({
  username,
  avatarUrl,
  fullName,
  className = 'avatar',
  alt,
}: AvatarProps) {
  const initial = ((fullName || username || '?')[0] || '?').toUpperCase()
  const label = alt ?? fullName ?? username

  if (avatarUrl) {
    return (
      <div className={`${className} has-image`}>
        <img src={avatarUrl} alt={label} />
      </div>
    )
  }

  return <div className={className}>{initial}</div>
}
