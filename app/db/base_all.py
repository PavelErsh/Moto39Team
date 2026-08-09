"""Импортирует все модели, чтобы они были зарегистрированы в Base.metadata.

Используется Alembic и при create_all для обнаружения всех таблиц.
"""
from app.db.base import Base  # noqa: F401
from app.models.chat import ChatMember, ChatRoom, Message  # noqa: F401
from app.models.email_verification import EmailVerificationCode  # noqa: F401
from app.models.event import Event  # noqa: F401
from app.models.motorcycle import Motorcycle  # noqa: F401
from app.models.push_subscription import PushSubscription  # noqa: F401
from app.models.ride import Ride  # noqa: F401
from app.models.user import User  # noqa: F401
