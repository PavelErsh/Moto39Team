"""Модель пользователя."""
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.motorcycle import Motorcycle


class User(Base):
    """Пользователь системы."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    username: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # URL аватарки (относительный: /media/avatars/…) — опционально.
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Значок спонсора проекта — произвольный эмодзи (или короткая строка),
    # который админы выдают вручную после доната. Показывается рядом с
    # username во всех местах, где отображается пользователь.
    sponsor_badge: Mapped[str | None] = mapped_column(
        String(16), nullable=True, default=None
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    is_superuser: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Последние известные координаты пользователя (для карты райдеров).
    last_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Статус экстренной ситуации: None — обычный, "help" — нужна помощь,
    # "sos" — срочный вызов. Отображается на карте особым маркером.
    emergency_status: Mapped[str | None] = mapped_column(
        String(16), nullable=True, default=None
    )
    # Время установки emergency_status. Используется для авто-сброса:
    #   sos  → 1 час,
    #   help → 2 часа.
    emergency_status_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    motorcycles: Mapped[list["Motorcycle"]] = relationship(
        "Motorcycle",
        back_populates="owner",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="Motorcycle.created_at",
    )
