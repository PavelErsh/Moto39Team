"""Роуты мотосправки (справочных статей).

Просмотр списка/статьи — доступен всем (включая неавторизованных).
Создание/редактирование/удаление/загрузка изображений — только для админов.
"""
from fastapi import APIRouter, File, HTTPException, UploadFile, status


from app.api.deps import CurrentSuperuser, DbSession
from app.api.v1._uploads import save_uploaded_image
from app.crud.reference import reference_crud
from app.schemas.reference import (
    ImageUploadResponse,
    ReferenceCreate,
    ReferenceRead,
    ReferenceUpdate,
)

router = APIRouter()


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
    # slug формируется автоматически на уровне CRUD: если клиент не
    # прислал slug, он строится из title, а коллизии разрешаются
    # добавлением числового суффикса (`-2`, `-3` и т.д.).
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
    url = await save_uploaded_image(file, "references")
    return ImageUploadResponse(url=url)
