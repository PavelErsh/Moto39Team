"""Импортирует все модели, чтобы они были зарегистрированы в Base.metadata.

Используется Alembic и при create_all для обнаружения всех таблиц.
"""
from app.db.base import Base  # noqa: F401
from app.models.event import Event  # noqa: F401
from app.models.motorcycle import Motorcycle  # noqa: F401
from app.models.user import User  # noqa: F401
