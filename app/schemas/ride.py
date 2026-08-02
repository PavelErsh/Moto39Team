"""Pydantic-схемы события (раздел «События» /rides)."""
from datetime import date as _date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RideBase(BaseModel):
    event_date: _date
    end_date: _date | None = None
    title: str = Field(min_length=1, max_length=255)
    organizer: str = Field(min_length=1, max_length=255)
    location: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=50000)
    cover_image_url: str | None = Field(default=None, max_length=500)
    images: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_dates(self) -> "RideBase":
        if self.end_date is not None and self.end_date < self.event_date:
            raise ValueError(
                "Дата окончания не может быть раньше даты начала"
            )
        return self


class RideCreate(RideBase):
    pass


class RideUpdate(BaseModel):
    event_date: _date | None = None
    end_date: _date | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    organizer: str | None = Field(default=None, min_length=1, max_length=255)
    location: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=50000)
    cover_image_url: str | None = Field(default=None, max_length=500)
    images: list[str] | None = None


class RideRead(RideBase):
    id: int
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
