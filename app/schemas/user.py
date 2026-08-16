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
    # Токен от Cloudflare Turnstile (капча). Обязателен, если на бэке
    # включён TURNSTILE_ENABLED. Приходит с фронта из виджета.
    turnstile_token: str | None = Field(default=None, max_length=4096)


class EmailVerificationRequest(BaseModel):
    """Тело запроса подтверждения регистрации кодом из письма."""

    email: EmailStr
    code: str = Field(min_length=4, max_length=16)


class ResendCodeRequest(BaseModel):
    """Тело запроса повторной отправки кода."""

    email: EmailStr


class PasswordResetRequest(BaseModel):
    """Запрос на отправку кода сброса пароля."""

    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    """Подтверждение сброса пароля кодом из письма."""

    email: EmailStr
    code: str = Field(min_length=4, max_length=16)
    new_password: str = Field(min_length=8, max_length=128)


class RegisterStartResponse(BaseModel):
    """Ответ на /auth/register: код отправлен, ждём подтверждения."""

    email: EmailStr
    message: str = "На указанный email отправлен код подтверждения"
    expires_in_minutes: int


class UserUpdate(BaseModel):

    email: EmailStr | None = None
    username: str | None = Field(default=None, min_length=3, max_length=64)
    full_name: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    avatar_url: str | None = Field(default=None, max_length=500)


class UserLogin(BaseModel):
    username: str
    password: str


class UserRead(BaseModel):
    """Данные текущего пользователя (эндпоинт /auth/me и т.п.).

    Здесь ``email`` и ``username`` — Optional, чтобы схема оставалась
    валидной для старых учёток, у которых в БД email/username могут быть
    NULL (последствие ручного создания таблицы users до появления
    актуальных миграций). Для новых регистраций эти поля всегда
    заполнены.
    """

    id: int
    email: EmailStr | None = None
    username: str | None = None
    full_name: str | None = None
    is_active: bool
    is_superuser: bool
    avatar_url: str | None = None
    # Значок спонсора проекта (эмодзи), если админ его выдал.
    sponsor_badge: str | None = None
    created_at: datetime
    updated_at: datetime
    # Текущий экстренный статус пользователя (None / "help" / "sos").
    # Возвращается в /auth/me, чтобы фронт мог отрисовать «свой» маркер
    # с нужным цветом и подписью, а также скрыть повторное открытие
    # диалога подтверждения, пока статус уже активен.
    emergency_status: str | None = None
    emergency_status_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)




class UserPublic(BaseModel):
    """Публичная информация о пользователе (для просмотра другими)."""

    id: int
    username: str
    full_name: str | None = None
    avatar_url: str | None = None
    sponsor_badge: str | None = None
    is_active: bool = True
    created_at: datetime
    motorcycles: list[MotorcycleRead] = []
    # Последние известные координаты (для отображения на профиле/списке).
    last_lat: float | None = None
    last_lng: float | None = None
    last_seen_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class LocationUpdate(BaseModel):
    """Данные обновления координат пользователя."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0, le=100000)


class EmergencyStatusUpdate(BaseModel):
    """Запрос на установку/сброс экстренного статуса.

    Помимо экстренных значений ``help`` / ``sos`` поле принимает
    значение ``riding`` — «я катаю». Это НЕ экстренный статус, а
    маркер активной поездки: сбрасывается автоматически через 3 часа,
    на карте райдер отображается зелёной меткой с подписью «КАТАЮ».
    """

    emergency_status: str | None = Field(
        default=None, pattern=r"^(help|sos|riding|)$"
    )


class UserLocation(BaseModel):

    """Публичная последняя позиция пользователя."""

    id: int
    username: str
    full_name: str | None = None
    avatar_url: str | None = None
    sponsor_badge: str | None = None
    lat: float
    lng: float
    accuracy: float | None = None
    last_seen_at: datetime
    emergency_status: str | None = None

    model_config = ConfigDict(from_attributes=True)
