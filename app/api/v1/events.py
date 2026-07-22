"""Роуты мотокалендаря (мероприятий).

Просмотр списка/детали — доступен всем (включая неавторизованных).
Создание/редактирование/удаление/загрузка изображений — только для админов.
"""
import secrets
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.api.deps import CurrentSuperuser, DbSession
from app.core.config import settings
from app.crud.event import event_crud
from app.schemas.event import EventCreate, EventRead, EventUpdate
from app.schemas.reference import ImageUploadResponse

router = APIRouter()


ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
HEIC_EXTENSIONS = {".heic", ".heif"}
MAX_IMAGE_SIZE = 16 * 1024 * 1024  # 16 MB


@router.get(
    "",
    response_model=list[EventRead],
    summary="Список мероприятий (мотокалендарь)",
)
async def list_events(db: DbSession) -> list[EventRead]:
    items = await event_crud.list_all(db)
    return [EventRead.model_validate(e) for e in items]


@router.get(
    "/{event_id}",
    response_model=EventRead,
    summary="Мероприятие по id",
)
async def get_event(event_id: int, db: DbSession) -> EventRead:
    event = await event_crud.get(db, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Мероприятие не найдено",
        )
    return EventRead.model_validate(event)


@router.post(
    "",
    response_model=EventRead,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить мероприятие (только админ)",
)
async def create_event(
    data: EventCreate,
    admin: CurrentSuperuser,
    db: DbSession,
) -> EventRead:
    event = await event_crud.create(db, data, created_by=admin.id)
    return EventRead.model_validate(event)


@router.patch(
    "/{event_id}",
    response_model=EventRead,
    summary="Обновить мероприятие (только админ)",
)
async def update_event(
    event_id: int,
    data: EventUpdate,
    _: CurrentSuperuser,
    db: DbSession,
) -> EventRead:
    event = await event_crud.get(db, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Мероприятие не найдено",
        )
    event = await event_crud.update(db, event, data)
    return EventRead.model_validate(event)


@router.delete(
    "/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить мероприятие (только админ)",
)
async def delete_event(
    event_id: int,
    _: CurrentSuperuser,
    db: DbSession,
) -> None:
    event = await event_crud.get(db, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Мероприятие не найдено",
        )
    await event_crud.delete(db, event)


@router.post(
    "/upload-image",
    response_model=ImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Загрузить изображение для мероприятия (только админ)",
)
async def upload_event_image(
    _: CurrentSuperuser,
    file: UploadFile = File(...),
) -> ImageUploadResponse:
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()
    if ext in HEIC_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Формат HEIC/HEIF не поддерживается. На iPhone включите "
                "«Настройки → Камера → Форматы → Наиболее совместимый», "
                "либо выберите фото и сохраните его как JPEG."
            ),
        )
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Неподдерживаемый формат. Разрешены: "
                + ", ".join(sorted(ALLOWED_IMAGE_EXTENSIONS))
            ),
        )

    data = await file.read(MAX_IMAGE_SIZE + 1)
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Файл слишком большой (максимум "
                f"{MAX_IMAGE_SIZE // (1024 * 1024)} МБ)"
            ),
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Файл пуст",
        )

    upload_dir = Path(settings.UPLOAD_DIR) / "events"
    upload_dir.mkdir(parents=True, exist_ok=True)

    unique_name = f"{secrets.token_urlsafe(16)}{ext}"
    dest = upload_dir / unique_name
    dest.write_bytes(data)

    url = f"/media/events/{unique_name}"
    return ImageUploadResponse(url=url)
