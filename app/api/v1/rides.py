"""Роуты раздела «События» (/rides).

Просмотр списка/детали — доступен всем (включая неавторизованных).
Создание/редактирование/удаление/загрузка изображений — только для админов.
"""
from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.api.deps import CurrentSuperuser, DbSession
from app.api.v1._uploads import save_uploaded_image
from app.crud.ride import ride_crud
from app.schemas.reference import ImageUploadResponse
from app.schemas.ride import RideCreate, RideRead, RideUpdate

router = APIRouter()


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
    url = await save_uploaded_image(file, "rides")
    return ImageUploadResponse(url=url)
