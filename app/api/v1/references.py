"""Роуты мотосправки (справочных статей).

Просмотр списка/статьи — доступен всем (включая неавторизованных).
Создание/редактирование/удаление/загрузка изображений — только для админов.
"""
import secrets
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status


from app.api.deps import CurrentSuperuser, DbSession
from app.core.config import settings
from app.crud.reference import reference_crud
from app.schemas.reference import (
    ImageUploadResponse,
    ReferenceCreate,
    ReferenceRead,
    ReferenceUpdate,
)

router = APIRouter()


ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
# HEIC/HEIF — стандартный формат iPhone. Мы его не поддерживаем (нужна
# отдельная библиотека для конвертации), но хотим показать пользователю
# внятную подсказку вместо сухого «неподдерживаемый формат».
HEIC_EXTENSIONS = {".heic", ".heif"}
MAX_IMAGE_SIZE = 16 * 1024 * 1024  # 16 MB — фото с телефонов бывают крупные


@router.get(
    "",
    response_model=list[ReferenceRead],
    summary="Список статей мотосправки",
)
async def list_references(db: DbSession) -> list[ReferenceRead]:
    items = await reference_crud.list_all(db)
    return [ReferenceRead.model_validate(r) for r in items]


@router.get(
    "/{key}",
    response_model=ReferenceRead,
    summary="Статья мотосправки по id или slug",
)
async def get_reference(key: str, db: DbSession) -> ReferenceRead:
    ref = await reference_crud.get_by_id_or_slug(db, key)
    if ref is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Статья не найдена",
        )
    return ReferenceRead.model_validate(ref)


@router.post(
    "",
    response_model=ReferenceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Создать статью (только админ)",
)
async def create_reference(
    data: ReferenceCreate,
    admin: CurrentSuperuser,
    db: DbSession,
) -> ReferenceRead:
    existing = await reference_crud.get_by_slug(db, data.slug)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Статья с таким slug уже существует",
        )
    ref = await reference_crud.create(db, data, created_by=admin.id)
    return ReferenceRead.model_validate(ref)


@router.patch(
    "/{ref_id}",
    response_model=ReferenceRead,
    summary="Обновить статью (только админ)",
)
async def update_reference(
    ref_id: int,
    data: ReferenceUpdate,
    _: CurrentSuperuser,
    db: DbSession,
) -> ReferenceRead:
    ref = await reference_crud.get(db, ref_id)
    if ref is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Статья не найдена",
        )
    if data.slug and data.slug != ref.slug:
        other = await reference_crud.get_by_slug(db, data.slug)
        if other is not None and other.id != ref.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Статья с таким slug уже существует",
            )
    ref = await reference_crud.update(db, ref, data)
    return ReferenceRead.model_validate(ref)


@router.delete(
    "/{ref_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить статью (только админ)",
)
async def delete_reference(
    ref_id: int,
    _: CurrentSuperuser,
    db: DbSession,
) -> None:
    ref = await reference_crud.get(db, ref_id)
    if ref is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Статья не найдена",
        )
    await reference_crud.delete(db, ref)


@router.post(
    "/upload-image",
    response_model=ImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Загрузить изображение для статьи (только админ)",
)
async def upload_reference_image(
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

    # Читаем данные с ограничением размера
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

    upload_dir = Path(settings.UPLOAD_DIR) / "references"
    upload_dir.mkdir(parents=True, exist_ok=True)

    unique_name = f"{secrets.token_urlsafe(16)}{ext}"
    dest = upload_dir / unique_name
    dest.write_bytes(data)

    # Относительный URL, чтобы не зависеть от домена/протокола фронта.
    url = f"/media/references/{unique_name}"
    return ImageUploadResponse(url=url)
