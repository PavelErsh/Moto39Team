"""Админские роуты: управление пользователями."""
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import CurrentSuperuser, DbSession
from app.crud.user import user_crud
from app.schemas.user import UserRead

router = APIRouter()


class AdminFlagPayload(BaseModel):
    is_superuser: bool


class ActiveFlagPayload(BaseModel):
    is_active: bool


class SponsorBadgePayload(BaseModel):
    # Пустая строка (или None) — сброс значка. Ограничение в 16 символов
    # позволяет вместить составные эмодзи с ZWJ/скин-тонами.
    sponsor_badge: str | None = Field(default=None, max_length=16)


@router.get(
    "/users",
    response_model=list[UserRead],
    summary="Список всех пользователей (только админ)",
)
async def list_users_full(
    _: CurrentSuperuser,
    db: DbSession,
) -> list[UserRead]:
    users = await user_crud.list_all(db)
    return [UserRead.model_validate(u) for u in users]


@router.patch(
    "/users/{user_id}/superuser",
    response_model=UserRead,
    summary="Выдать/забрать права администратора (только админ)",
)
async def set_superuser(
    user_id: int,
    payload: AdminFlagPayload,
    current_admin: CurrentSuperuser,
    db: DbSession,
) -> UserRead:
    user = await user_crud.get(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    if user.id == current_admin.id and not payload.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя снять права администратора с самого себя",
        )
    user.is_superuser = payload.is_superuser
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)


@router.patch(
    "/users/{user_id}/active",
    response_model=UserRead,
    summary="Активировать/деактивировать пользователя (только админ)",
)
async def set_active(
    user_id: int,
    payload: ActiveFlagPayload,
    current_admin: CurrentSuperuser,
    db: DbSession,
) -> UserRead:
    user = await user_crud.get(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    if user.id == current_admin.id and not payload.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя деактивировать самого себя",
        )
    user.is_active = payload.is_active
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)


@router.patch(
    "/users/{user_id}/sponsor-badge",
    response_model=UserRead,
    summary="Установить/сбросить значок спонсора (только админ)",
)
async def set_sponsor_badge(
    user_id: int,
    payload: SponsorBadgePayload,
    _: CurrentSuperuser,
    db: DbSession,
) -> UserRead:
    user = await user_crud.get(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    # Нормализуем: пустая строка после trim — сброс значка (NULL в БД).
    raw = (payload.sponsor_badge or "").strip()
    user.sponsor_badge = raw or None
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)
