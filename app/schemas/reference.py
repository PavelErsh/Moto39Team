"""Pydantic-схемы для статей мотосправки."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ReferenceBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=160, pattern=r"^[a-z0-9\-]+$")
    category: str | None = Field(default=None, max_length=100)
    summary: str | None = Field(default=None, max_length=500)
    content: str = Field(default="", max_length=50000)
    cover_image_url: str | None = Field(default=None, max_length=500)
    images: list[str] = Field(default_factory=list)


class ReferenceCreate(ReferenceBase):
    pass


class ReferenceUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    slug: str | None = Field(
        default=None, min_length=1, max_length=160, pattern=r"^[a-z0-9\-]+$"
    )
    category: str | None = Field(default=None, max_length=100)
    summary: str | None = Field(default=None, max_length=500)
    content: str | None = Field(default=None, max_length=50000)
    cover_image_url: str | None = Field(default=None, max_length=500)
    images: list[str] | None = None


class ReferenceRead(ReferenceBase):
    id: int
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ImageUploadResponse(BaseModel):
    url: str
