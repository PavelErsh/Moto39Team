"""CRUD-операции для пользователя."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate


class UserCRUD:
    """Инкапсулирует работу с моделью User."""

    async def get(self, db: AsyncSession, user_id: int) -> User | None:
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def list_all(
        self, db: AsyncSession, *, active_only: bool = False
    ) -> list[User]:
        stmt = select(User).order_by(User.username)
        if active_only:
            stmt = stmt.where(User.is_active.is_(True))
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def get_by_email(self, db: AsyncSession, email: str) -> User | None:
        result = await db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_by_username(
        self, db: AsyncSession, username: str
    ) -> User | None:
        result = await db.execute(
            select(User).where(User.username == username)
        )
        return result.scalar_one_or_none()

    async def create(self, db: AsyncSession, data: UserCreate) -> User:
        user = User(
            email=data.email,
            username=data.username,
            full_name=data.full_name,
            hashed_password=hash_password(data.password),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user

    async def update(
        self, db: AsyncSession, user: User, data: UserUpdate
    ) -> User:
        update_data = data.model_dump(exclude_unset=True)
        if "password" in update_data:
            update_data["hashed_password"] = hash_password(
                update_data.pop("password")
            )
        for field, value in update_data.items():
            setattr(user, field, value)
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user

    async def update_location(
        self,
        db: AsyncSession,
        user: User,
        lat: float,
        lng: float,
        accuracy: float | None,
    ) -> User:
        user.last_lat = lat
        user.last_lng = lng
        user.last_accuracy = accuracy
        user.last_seen_at = datetime.now(timezone.utc)
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user

    async def list_with_location(
        self, db: AsyncSession, max_age_minutes: int | None = None
    ) -> list[User]:
        """Список пользователей, у которых есть последние координаты.

        Если задан max_age_minutes — отфильтровать по свежести.
        """
        stmt = (
            select(User)
            .where(
                User.is_active.is_(True),
                User.last_lat.is_not(None),
                User.last_lng.is_not(None),
                User.last_seen_at.is_not(None),
            )
            .order_by(User.username)
        )
        if max_age_minutes is not None:
            cutoff = datetime.now(timezone.utc) - timedelta(
                minutes=max_age_minutes
            )
            stmt = stmt.where(User.last_seen_at >= cutoff)
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def authenticate(
        self, db: AsyncSession, username: str, password: str
    ) -> User | None:
        """Ищем пользователя по username или email."""
        user = await self.get_by_username(db, username)
        if user is None:
            user = await self.get_by_email(db, username)
        if user is None:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        return user


user_crud = UserCRUD()
