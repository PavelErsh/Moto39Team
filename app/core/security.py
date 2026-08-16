"""Функции безопасности: хеширование паролей и работа с JWT."""
from datetime import UTC, datetime, timedelta
from uuid import uuid4
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Захешировать пароль."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Проверить пароль."""
    return pwd_context.verify(plain_password, hashed_password)


def _create_token(
    subject: str | int,
    expires_delta: timedelta,
    token_type: str,
    *,
    jti: str | None = None,
) -> str:
    to_encode: dict[str, Any] = {
        "sub": str(subject),
        "exp": datetime.now(UTC) + expires_delta,
        "iat": datetime.now(UTC),
        "type": token_type,
    }
    if jti is not None:
        to_encode["jti"] = jti
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(subject: str | int) -> str:
    """Создать access-токен."""
    return _create_token(
        subject=subject,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        token_type="access",
    )


def create_refresh_token(subject: str | int, *, jti: str | None = None) -> str:
    """Создать refresh-токен.

    refresh-токен получает уникальный ``jti`` (JWT ID), чтобы сервер мог
    хранить и отзывать конкретную refresh-сессию в БД. Это делает вход
    устойчивым к рестартам процесса и позволяет безопасную ротацию токенов.
    """
    return _create_token(
        subject=subject,
        expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        token_type="refresh",
        jti=jti or uuid4().hex,
    )


def decode_token(token: str) -> dict[str, Any]:
    """Декодировать JWT. Бросает JWTError при ошибке."""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


__all__ = [
    "JWTError",
    "hash_password",
    "verify_password",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
]
