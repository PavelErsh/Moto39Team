"""Pydantic-схемы пользователя."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.motorcycle import MotorcycleRead


class UserBase(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=64)
    full_name: str | None = Field(default=None, max_length=255)


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    username: str | None = Field(default=None, min_length=3, max_length=64)
    full_name: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserLogin(BaseModel):
    username: str
    password: str


class UserRead(UserBase):
    id: int
    is_active: bool
    is_superuser: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserPublic(BaseModel):
    """Публичная информация о пользователе (для просмотра другими)."""

    id: int
    username: str
    full_name: str | None = None
    created_at: datetime
    motorcycles: list[MotorcycleRead] = []

    model_config = ConfigDict(from_attributes=True)


class LocationUpdate(BaseModel):
    """Данные обновления координат пользователя."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0, le=100000)


class UserLocation(BaseModel):
    """Публичная последняя позиция пользователя."""

    id: int
    username: str
    full_name: str | None = None
    lat: float
    lng: float
    accuracy: float | None = None
    last_seen_at: datetime

    model_config = ConfigDict(from_attributes=True)
