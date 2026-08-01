"""Модель кода подтверждения e-mail при регистрации.

Хранит одноразовый код, отправленный на email пользователя. Пароль
пользователя мы храним заранее хешированным — при верификации создаётся
запись в ``users``. Так мы не создаём «висячих» неактивированных
аккаунтов и не занимаем логин/почту до подтверждения.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EmailVerificationCode(Base):
    """Отложенная регистрация: черновик пользователя + одноразовый код."""

    __tablename__ = "email_verification_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Email, куда отправляется код. Индексируем для быстрого поиска
    # активного кода при повторной отправке.
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)

    # Черновик данных пользователя (то, что он ввёл при регистрации).
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    # 6-значный код, приходящий в письме.
    code: Mapped[str] = mapped_column(String(16), nullable=False)

    # Количество неверных попыток ввода кода.
    attempts: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Момент последней отправки письма (для rate-limit ресенда).
    last_sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
