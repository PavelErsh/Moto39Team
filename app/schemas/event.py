"""Pydantic-схемы мероприятия (мотокалендарь)."""
from datetime import date as _date, datetime

from pydantic import BaseModel, ConfigDict, Field


class EventBase(BaseModel):
    event_date: _date
    title: str = Field(min_length=1, max_length=255)
    organizer: str = Field(min_length=1, max_length=255)
    location: str = Field(min_length=1, max_length=255)
    # Описание — теперь большой текст (до 50k символов), чтобы можно было
    # публиковать полноценные посты с деталями, программой и т.п.
    description: str | None = Field(default=None, max_length=50000)
    # Обложка карточки (URL относительный — /media/events/...)
    cover_image_url: str | None = Field(default=None, max_length=500)
    # Прикреплённая галерея изображений
    images: list[str] = Field(default_factory=list)


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    event_date: _date | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    organizer: str | None = Field(default=None, min_length=1, max_length=255)
    location: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=50000)
    cover_image_url: str | None = Field(default=None, max_length=500)
    images: list[str] | None = None


class EventRead(EventBase):
    id: int
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
