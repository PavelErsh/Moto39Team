"""Pydantic-схемы мероприятия (мотокалендарь)."""
from datetime import date as _date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class EventBase(BaseModel):
    # Дата начала мероприятия
    event_date: _date
    # Дата окончания (опционально; для однодневных не указывается либо
    # совпадает с датой начала)
    end_date: _date | None = None
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

    @model_validator(mode="after")
    def _validate_dates(self) -> "EventBase":
        if self.end_date is not None and self.end_date < self.event_date:
            raise ValueError(
                "Дата окончания не может быть раньше даты начала"
            )
        return self


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    event_date: _date | None = None
    end_date: _date | None = None
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
