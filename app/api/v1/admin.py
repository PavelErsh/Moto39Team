"""Админские роуты: управление пользователями."""
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import CurrentSuperuser, DbSession
from app.crud import chat as chat_crud
from app.crud.user import user_crud
from app.schemas.chat import ChatMemberRead
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


def _member_to_read(member) -> ChatMemberRead:
    return ChatMemberRead(
        id=member.id,
        user_id=member.user_id,
        role=member.role,
        joined_at=member.joined_at,
        username=member.user.username if member.user else None,
        avatar_url=member.user.avatar_url if member.user else None,
        sponsor_badge=member.user.sponsor_badge if member.user else None,
    )


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


@router.get(
    "/chat/bikechat/users",
    response_model=list[ChatMemberRead],
    summary="Участники чата БАЙКЧАТ (только админ)",
)
async def list_bikechat_users(
    _: CurrentSuperuser,
    db: DbSession,
) -> list[ChatMemberRead]:
    room = await chat_crud.ensure_default_bike_chat(db)
    room = await chat_crud.get_room(db, room.id)
    if room is None:
        return []
    return [_member_to_read(member) for member in room.members]


@router.get(
    "/chat/bikechat/available-users",
    response_model=list[UserRead],
    summary="Пользователи, которых можно добавить в БАЙКЧАТ (только админ)",
)
async def list_bikechat_available_users(
    _: CurrentSuperuser,
    db: DbSession,
) -> list[UserRead]:
    room = await chat_crud.ensure_default_bike_chat(db)
    room = await chat_crud.get_room(db, room.id)
    member_ids = {member.user_id for member in room.members} if room else set()
    users = await user_crud.list_all(db)
    return [
        UserRead.model_validate(user)
        for user in users
        if user.id not in member_ids
    ]


@router.post(
    "/chat/bikechat/users/{user_id}",
    response_model=list[ChatMemberRead],
    summary="Добавить пользователя в БАЙКЧАТ (только админ)",
)
async def add_user_to_bikechat(
    user_id: int,
    current_admin: CurrentSuperuser,
    db: DbSession,
) -> list[ChatMemberRead]:
    user = await user_crud.get(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    room = await chat_crud.ensure_user_in_default_bike_chat(
        db,
        user_id,
        room_created_by=current_admin.id,
    )
    room = await chat_crud.get_room(db, room.id)
    if room is None:
        return []
    return [_member_to_read(member) for member in room.members]


@router.delete(
    "/chat/bikechat/users/{user_id}",
    response_model=list[ChatMemberRead],
    summary="Удалить пользователя из БАЙКЧАТ (только админ)",
)
async def remove_user_from_bikechat(
    user_id: int,
    _: CurrentSuperuser,
    db: DbSession,
) -> list[ChatMemberRead]:
    room = await chat_crud.ensure_default_bike_chat(db)
    if not await chat_crud.is_member(db, room.id, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не состоит в БАЙКЧАТ",
        )
    await chat_crud.remove_members(db, room.id, [user_id])
    room = await chat_crud.get_room(db, room.id)
    if room is None:
        return []
    return [_member_to_read(member) for member in room.members]
