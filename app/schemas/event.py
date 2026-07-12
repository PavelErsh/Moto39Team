"""Pydantic-схемы мероприятия (мотокалендарь)."""
from datetime import date as _date, datetime

from pydantic import BaseModel, ConfigDict, Field


class EventBase(BaseModel):
    event_date: _date
    title: str = Field(min_length=1, max_length=255)
    organizer: str = Field(min_length=1, max_length=255)
    location: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    event_date: _date | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    organizer: str | None = Field(default=None, min_length=1, max_length=255)
    location: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)


class EventRead(EventBase):
    id: int
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
