"""Модель Push-подписки для Web Push API (PWA)."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PushSubscription(Base):
    """Push-подписка пользователя (endpoint + keys для Web Push)."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Endpoint, выданный браузерным Push Service (FCM/Mozilla/etc.)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    # p256dh ключ (base64url без padding)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    # auth секрет (base64url без padding)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    # Платформа / user-agent для отладки
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
