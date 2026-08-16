"""Журнал отправки системных push-уведомлений."""
from datetime import date as _date
from datetime import datetime

from sqlalchemy import Date, DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PushDeliveryLog(Base):
    """Фиксирует, что конкретное системное уведомление уже было отправлено.

    Нужен для защиты от повторной отправки напоминаний о событиях,
    когда фоновой воркер запускается периодически.
    """

    __tablename__ = "push_delivery_logs"
    __table_args__ = (
        UniqueConstraint(
            "notification_type",
            "entity_type",
            "entity_id",
            "target_date",
            name="uq_push_delivery_logs_notification_entity_target",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    notification_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    target_date: Mapped[_date] = mapped_column(Date, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
