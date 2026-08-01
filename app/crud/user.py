"""CRUD-операции для пользователя."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import nulls_last

from app.core.security import hash_password, verify_password
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate


class UserCRUD:
    """Инкапсулирует работу с моделью User."""

    async def get(self, db: AsyncSession, user_id: int) -> User | None:
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def list_all(
        self,
        db: AsyncSession,
        *,
        active_only: bool = False,
        order_by_last_seen: bool = False,
    ) -> list[User]:
        """Список пользователей.

        При ``order_by_last_seen=True`` пользователи сортируются по
        последней активности (свежие сверху, никогда не выходившие —
        внизу). Иначе используется алфавитная сортировка по username.
        """
        stmt = select(User)
        if active_only:
            stmt = stmt.where(User.is_active.is_(True))
        if order_by_last_seen:
            stmt = stmt.order_by(
                nulls_last(User.last_seen_at.desc()),
                User.username,
            )
        else:
            stmt = stmt.order_by(User.username)
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

    async def create_from_verified(
        self,
        db: AsyncSession,
        *,
        email: str,
        username: str,
        full_name: str | None,
        hashed_password: str,
    ) -> User:
        """Создать пользователя с уже готовым (хешированным) паролем.

        Используется на шаге подтверждения email: пароль был захеширован
        ещё на этапе /auth/register и хранится в EmailVerificationCode.
        """
        user = User(
            email=email,
            username=username,
            full_name=full_name,
            hashed_password=hashed_password,
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

    async def touch_last_seen(
        self,
        db: AsyncSession,
        user: User,
        *,
        min_interval_seconds: int = 60,
    ) -> None:
        """Пассивно продвинуть ``last_seen_at`` пользователя.

        Вызывается на каждом авторизованном запросе (см.
        ``get_current_active_user``). Мы не хотим писать в БД на КАЖДЫЙ
        запрос — это дорого; поэтому обновляем не чаще, чем раз в
        ``min_interval_seconds`` секунд. Так у любого «живого»
        пользователя ``last_seen_at`` продвигается, даже если он не
        делится геолокацией (например, отключил её на десктопе или
        временно отозвал разрешение на телефоне).

        Обновление выполняется прямым UPDATE в обход ORM, чтобы
        SQLAlchemy не помечал атрибуты объекта ``User`` как
        «просроченные» после flush (из-за ``onupdate=func.now()`` на
        ``updated_at`` и связей типа ``motorcycles``). Иначе последующая
        сериализация в pydantic попыталась бы асинхронно перезагрузить
        атрибуты вне greenlet-контекста и упала бы с MissingGreenlet.
        Значение ``last_seen_at`` мы аккуратно проставляем в памяти
        объекта прямо здесь.
        """
        now = datetime.now(timezone.utc)
        last = user.last_seen_at
        if last is not None:
            # SQLite мог сохранить naive-datetime — приводим к aware.
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if (now - last).total_seconds() < min_interval_seconds:
                return
        try:
            await db.execute(
                update(User)
                .where(User.id == user.id)
                .values(last_seen_at=now)
                .execution_options(synchronize_session=False)
            )
            await db.commit()
            # Обновим объект в памяти, чтобы сериализация в ответе
            # содержала свежий last_seen_at (без повторного SELECT).
            user.last_seen_at = now
        except Exception:  # noqa: BLE001
            # Не роняем запрос, если по каким-то причинам коммит не
            # прошёл (например, транзакция занята вложенной операцией).
            # На следующем запросе снова попробуем.
            await db.rollback()

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
