"""Базовый декларативный класс для SQLAlchemy моделей."""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Базовый класс всех ORM-моделей."""
