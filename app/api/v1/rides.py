"""Роуты раздела «События» (/rides).

Просмотр списка/детали — доступен всем (включая неавторизованных).
Создание/редактирование/удаление/загрузка изображений — только для админов.
"""
import secrets
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.api.deps import CurrentSuperuser, DbSession
from app.core.config import settings
from app.crud.ride import ride_crud
from app.schemas.reference import ImageUploadResponse
from app.schemas.ride import RideCreate, RideRead, RideUpdate

router = APIRouter()


ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
HEIC_EXTENSIONS = {".heic", ".heif"}
MAX_IMAGE_SIZE = 16 * 1024 * 1024  # 16 MB


@router.get(
    "",
    response_model=list[RideRead],
    summary="Список событий",
)
async def list_rides(db: DbSession) -> list[RideRead]:
    items = await ride_crud.list_all(db)
    return [RideRead.model_validate(r) for r in items]


@router.get(
    "/{ride_id}",
    response_model=RideRead,
    summary="Событие по id",
)
async def get_ride(ride_id: int, db: DbSession) -> RideRead:
    ride = await ride_crud.get(db, ride_id)
    if ride is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Событие не найдено",
        )
    return RideRead.model_validate(ride)


@router.post(
    "",
    response_model=RideRead,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить событие (только админ)",
)
async def create_ride(
    data: RideCreate,
    admin: CurrentSuperuser,
    db: DbSession,
) -> RideRead:
    ride = await ride_crud.create(db, data, created_by=admin.id)
    return RideRead.model_validate(ride)


@router.patch(
    "/{ride_id}",
    response_model=RideRead,
    summary="Обновить событие (только админ)",
)
async def update_ride(
    ride_id: int,
    data: RideUpdate,
    _: CurrentSuperuser,
    db: DbSession,
) -> RideRead:
    ride = await ride_crud.get(db, ride_id)
    if ride is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Событие не найдено",
        )
    ride = await ride_crud.update(db, ride, data)
    return RideRead.model_validate(ride)


@router.delete(
    "/{ride_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить событие (только админ)",
)
async def delete_ride(
    ride_id: int,
    _: CurrentSuperuser,
    db: DbSession,
) -> None:
    ride = await ride_crud.get(db, ride_id)
    if ride is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Событие не найдено",
        )
    await ride_crud.delete(db, ride)


@router.post(
    "/upload-image",
    response_model=ImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Загрузить изображение для события (только админ)",
)
async def upload_ride_image(
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

    upload_dir = Path(settings.UPLOAD_DIR) / "rides"
    upload_dir.mkdir(parents=True, exist_ok=True)

    unique_name = f"{secrets.token_urlsafe(16)}{ext}"
    dest = upload_dir / unique_name
    dest.write_bytes(data)

    url = f"/media/rides/{unique_name}"
    return ImageUploadResponse(url=url)
