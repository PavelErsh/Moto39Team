"""Общие зависимости API."""
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import JWTError, decode_token
from app.crud.user import user_crud
from app.db.session import get_db
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

DbSession = Annotated[AsyncSession, Depends(get_db)]
TokenDep = Annotated[str, Depends(oauth2_scheme)]


async def get_current_user(db: DbSession, token: TokenDep) -> User:
    """Получить текущего пользователя из access-токена."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось проверить учётные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise credentials_exception
        user_id_raw: str | None = payload.get("sub")
        if user_id_raw is None:
            raise credentials_exception
        user_id = int(user_id_raw)
    except (JWTError, ValueError) as exc:
        raise credentials_exception from exc

    user = await user_crud.get(db, user_id)
    if user is None:
        raise credentials_exception
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_current_active_user(
    current_user: CurrentUser, db: DbSession
) -> User:
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неактивный пользователь",
        )
    # Пассивно обновляем «последнее время активности» пользователя на
    # любом авторизованном запросе. Это гарантирует, что в списке
    # райдеров и на карте `last_seen_at` двигается для любого «живого»
    # пользователя, даже если он не делится геолокацией (например,
    # отключил её в браузере). Реальная запись в БД происходит не чаще
    # раза в минуту — см. `UserCRUD.touch_last_seen`.
    await user_crud.touch_last_seen(db, current_user)
    return current_user


CurrentActiveUser = Annotated[User, Depends(get_current_active_user)]


async def get_current_superuser(current_user: CurrentActiveUser) -> User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Требуются права суперпользователя",
        )
    return current_user


CurrentSuperuser = Annotated[User, Depends(get_current_superuser)]
