"""Модель мероприятия мотокалендаря."""
from datetime import date as _date, datetime

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Event(Base):
    """Мероприятие (мотокалендарь).

    Хранит информацию о мото-мероприятиях, которую видят все пользователи,
    но редактировать могут только администраторы.

    Мероприятие может занимать один день (`event_date`) либо несколько
    дней — в этом случае указывается `end_date` (последний день события).
    """

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Дата начала мероприятия (для многодневных — первый день)
    event_date: Mapped[_date] = mapped_column(Date, nullable=False, index=True)
    # Дата окончания (последний день). Опциональна: если не указана,
    # событие считается однодневным.
    end_date: Mapped[_date | None] = mapped_column(
        Date, nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    organizer: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Обложка карточки мероприятия и галерея изображений (по аналогии
    # с мотосправкой). Обе колонки опциональны, чтобы старые записи
    # не требовали значений.
    cover_image_url: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )
    images: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )

    created_by: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
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

    author = relationship("User", foreign_keys=[created_by])
