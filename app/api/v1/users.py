"""Роуты работы с пользователями."""
import asyncio

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.api.deps import CurrentActiveUser, CurrentSuperuser, DbSession
from app.api.v1._uploads import save_uploaded_image
from app.crud.user import user_crud
from app.schemas.reference import ImageUploadResponse
from app.schemas.user import (
    EmergencyStatusUpdate,
    LocationUpdate,
    UserLocation,
    UserPublic,
    UserRead,
    UserUpdate,
)
from app.services.push import PushPayload, push_service

router = APIRouter()


def _build_emergency_push_payload(user, status_value: str) -> PushPayload:
    display_name = user.full_name or user.username or f"Пользователь #{user.id}"
    if status_value == "sos":
        return PushPayload(
            title="🚨 SOS",
            body=f"{display_name} попал(а) в серьёзное происшествие.",
            tag="emergency-sos",
            url="/map",
            data={
                "type": "emergency_status",
                "status": "sos",
                "user_id": user.id,
                "username": user.username,
            },
        )
    if status_value == "help":
        return PushPayload(
            title="⚠️ HELP",
            body=f"{display_name} нуждается в помощи.",
            tag="emergency-help",
            url="/map",
            data={
                "type": "emergency_status",
                "status": "help",
                "user_id": user.id,
                "username": user.username,
            },
        )
    return PushPayload(
        title="🏍️ Я катаю",
        body=(
            f"{display_name} катается, вы можете присоединиться "
            "и прокатиться вместе."
        ),
        tag="emergency-riding",
        url="/map",
        data={
            "type": "emergency_status",
            "status": "riding",
            "user_id": user.id,
            "username": user.username,
        },
    )


def _to_location(user) -> UserLocation:
    return UserLocation(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
        sponsor_badge=getattr(user, "sponsor_badge", None),
        lat=user.last_lat,
        lng=user.last_lng,
        accuracy=user.last_accuracy,
        last_seen_at=user.last_seen_at,
        emergency_status=user.emergency_status,
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


@router.post(
    "/me/avatar",
    response_model=UserRead,
    summary="Загрузить/обновить свою аватарку",
)
async def upload_my_avatar(
    current_user: CurrentActiveUser,
    db: DbSession,
    file: UploadFile = File(...),
) -> UserRead:
    """Сохраняет файл в /media/avatars и обновляет ``avatar_url`` профиля."""
    url = await save_uploaded_image(file, "avatars")
    user = await user_crud.update(
        db, current_user, UserUpdate(avatar_url=url)
    )
    return UserRead.model_validate(user)


@router.delete(
    "/me/avatar",
    response_model=UserRead,
    summary="Удалить аватарку",
)
async def delete_my_avatar(
    current_user: CurrentActiveUser,
    db: DbSession,
) -> UserRead:
    user = await user_crud.update(
        db, current_user, UserUpdate(avatar_url=None)
    )
    return UserRead.model_validate(user)


@router.post(
    "/upload-avatar",
    response_model=ImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Загрузить изображение аватара (без привязки к профилю)",
)
async def upload_avatar_image(
    _: CurrentActiveUser,
    file: UploadFile = File(...),
) -> ImageUploadResponse:
    """URL сохранённого файла (привязку выполнит PATCH /users/me)."""
    url = await save_uploaded_image(file, "avatars")
    return ImageUploadResponse(url=url)


@router.get(
    "",
    response_model=list[UserPublic],
    summary="Список пользователей (публичный)",
)
async def list_users(
    _: CurrentActiveUser,
    db: DbSession,
) -> list[UserPublic]:
    # Заблокированные пользователи не попадают в общий публичный список.
    # Сортировка: сначала те, кто был активен недавно, в конце — те,
    # кто давно не выходил в сеть (или ни разу не делился координатами).
    users = await user_crud.list_all(
        db, active_only=True, order_by_last_seen=True
    )
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


@router.delete(
    "/me/location",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить свою метку с карты (отключить трекинг)",
)
async def clear_my_location(
    current_user: CurrentActiveUser,
    db: DbSession,
) -> None:
    """Пользователь нажал «Не отслеживать меня».

    Обнуляем ``last_lat`` / ``last_lng`` / ``last_accuracy`` в БД,
    чтобы у других райдеров метка сразу пропала (эндпоинт
    ``/users/locations`` фильтрует по IS NOT NULL). Также
    сбрасываем активный emergency_status — без координат он
    не имеет смысла.
    """
    await user_crud.clear_location(db, current_user)
    return None


@router.post(
    "/me/emergency",
    response_model=UserLocation,
    summary="Установить или сбросить экстренный статус (help/sos)",
)
async def update_emergency_status(
    data: EmergencyStatusUpdate,
    current_user: CurrentActiveUser,
    db: DbSession,
) -> UserLocation:
    """Статус ``help`` или ``sos`` меняет вид маркера на карте для других."""
    # Пустая строка означает сброс статуса — приводим к None.
    status = data.emergency_status.strip() if data.emergency_status else None
    user = await user_crud.update_emergency_status(db, current_user, status)
    if status in {"help", "sos", "riding"}:
        asyncio.create_task(
            push_service.broadcast(_build_emergency_push_payload(user, status))
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
