"""Модель статьи мотосправки."""
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Reference(Base):
    """Статья мотосправки.

    Справочная информация, которую видят все пользователи,
    а редактировать могут только администраторы.
    """

    __tablename__ = "references"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    slug: Mapped[str] = mapped_column(
        String(160), nullable=False, unique=True, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")

    cover_image_url: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )
    # список URL прикреплённых изображений
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
