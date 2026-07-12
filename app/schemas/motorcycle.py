"""Pydantic-схемы мотоцикла."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class MotorcycleBase(BaseModel):
    brand: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=100)
    year: int | None = Field(default=None, ge=1885, le=2100)
    engine_cc: int | None = Field(default=None, ge=1, le=10000)
    color: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=2000)


class MotorcycleCreate(MotorcycleBase):
    pass


class MotorcycleUpdate(BaseModel):
    brand: str | None = Field(default=None, min_length=1, max_length=100)
    model: str | None = Field(default=None, min_length=1, max_length=100)
    year: int | None = Field(default=None, ge=1885, le=2100)
    engine_cc: int | None = Field(default=None, ge=1, le=10000)
    color: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=2000)


class MotorcycleRead(MotorcycleBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
