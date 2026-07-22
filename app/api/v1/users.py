"""Роуты работы с пользователями."""
from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentActiveUser, CurrentSuperuser, DbSession
from app.crud.user import user_crud
from app.schemas.user import (
    LocationUpdate,
    UserLocation,
    UserPublic,
    UserRead,
    UserUpdate,
)

router = APIRouter()


def _to_location(user) -> UserLocation:
    return UserLocation(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        lat=user.last_lat,
        lng=user.last_lng,
        accuracy=user.last_accuracy,
        last_seen_at=user.last_seen_at,
    )


@router.get(
    "/me",
    response_model=UserRead,
    summary="Профиль текущего пользователя",
)
async def get_me(current_user: CurrentActiveUser) -> UserRead:
    return UserRead.model_validate(current_user)


@router.patch(
    "/me",
    response_model=UserRead,
    summary="Обновить данные текущего пользователя",
)
async def update_me(
    data: UserUpdate,
    current_user: CurrentActiveUser,
    db: DbSession,
) -> UserRead:
    user = await user_crud.update(db, current_user, data)
    return UserRead.model_validate(user)


@router.get(
    "",
    response_model=list[UserPublic],
    summary="Список пользователей (публичный)",
)
async def list_users(
    _: CurrentActiveUser,
    db: DbSession,
) -> list[UserPublic]:
    users = await user_crud.list_all(db)
    return [UserPublic.model_validate(u) for u in users]


@router.post(
    "/me/location",
    response_model=UserLocation,
    summary="Обновить свои координаты",
)
async def update_my_location(
    data: LocationUpdate,
    current_user: CurrentActiveUser,
    db: DbSession,
) -> UserLocation:
    user = await user_crud.update_location(
        db, current_user, data.lat, data.lng, data.accuracy
    )
    return _to_location(user)


@router.get(
    "/locations",
    response_model=list[UserLocation],
    summary="Последние координаты всех активных райдеров",
)
async def list_user_locations(
    current_user: CurrentActiveUser,
    db: DbSession,
    max_age_minutes: int | None = 60 * 24,
) -> list[UserLocation]:
    users = await user_crud.list_with_location(
        db, max_age_minutes=max_age_minutes
    )
    # Себя из списка исключаем — на карте мы уже отображаемся отдельной меткой.
    return [_to_location(u) for u in users if u.id != current_user.id]


@router.get(
    "/by-username/{username}",
    response_model=UserPublic,
    summary="Публичный профиль пользователя по username",
)
async def get_user_by_username(
    username: str,
    _: CurrentActiveUser,
    db: DbSession,
) -> UserPublic:
    user = await user_crud.get_by_username(db, username)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    return UserPublic.model_validate(user)


@router.get(
    "/{user_id}",
    response_model=UserPublic,
    summary="Публичный профиль пользователя по id",
)
async def get_user_public(
    user_id: int,
    _: CurrentActiveUser,
    db: DbSession,
) -> UserPublic:
    user = await user_crud.get(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    return UserPublic.model_validate(user)


@router.get(
    "/{user_id}/full",
    response_model=UserRead,
    summary="Полные данные пользователя (только суперпользователь)",
)
async def get_user_full(
    user_id: int,
    _: CurrentSuperuser,
    db: DbSession,
) -> UserRead:
    user = await user_crud.get(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    return UserRead.model_validate(user)
