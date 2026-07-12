"""Роуты работы с гаражом (мотоциклами пользователя)."""
from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentActiveUser, DbSession
from app.crud.motorcycle import motorcycle_crud
from app.schemas.motorcycle import (
    MotorcycleCreate,
    MotorcycleRead,
    MotorcycleUpdate,
)

router = APIRouter()


@router.get(
    "/me",
    response_model=list[MotorcycleRead],
    summary="Список моих мотоциклов",
)
async def list_my_motorcycles(
    current_user: CurrentActiveUser,
    db: DbSession,
) -> list[MotorcycleRead]:
    items = await motorcycle_crud.list_by_user(db, current_user.id)
    return [MotorcycleRead.model_validate(m) for m in items]


@router.post(
    "",
    response_model=MotorcycleRead,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить мотоцикл в свой гараж",
)
async def create_motorcycle(
    data: MotorcycleCreate,
    current_user: CurrentActiveUser,
    db: DbSession,
) -> MotorcycleRead:
    moto = await motorcycle_crud.create(db, current_user.id, data)
    return MotorcycleRead.model_validate(moto)


@router.patch(
    "/{moto_id}",
    response_model=MotorcycleRead,
    summary="Обновить свой мотоцикл",
)
async def update_motorcycle(
    moto_id: int,
    data: MotorcycleUpdate,
    current_user: CurrentActiveUser,
    db: DbSession,
) -> MotorcycleRead:
    moto = await motorcycle_crud.get(db, moto_id)
    if moto is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Мотоцикл не найден",
        )
    if moto.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Это не ваш мотоцикл",
        )
    moto = await motorcycle_crud.update(db, moto, data)
    return MotorcycleRead.model_validate(moto)


@router.delete(
    "/{moto_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить мотоцикл из своего гаража",
)
async def delete_motorcycle(
    moto_id: int,
    current_user: CurrentActiveUser,
    db: DbSession,
) -> None:
    moto = await motorcycle_crud.get(db, moto_id)
    if moto is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Мотоцикл не найден",
        )
    if moto.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Это не ваш мотоцикл",
        )
    await motorcycle_crud.delete(db, moto)
