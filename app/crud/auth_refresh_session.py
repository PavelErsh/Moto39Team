"""CRUD для устойчивых refresh-сессий."""
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.auth_refresh_session import AuthRefreshSession


class AuthRefreshSessionCRUD:
    """Работа с refresh-сессиями, хранящимися в БД."""

    async def create(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        jti: str,
        expires_at: datetime,
    ) -> AuthRefreshSession:
        session = AuthRefreshSession(user_id=user_id, jti=jti, expires_at=expires_at)
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return session

    async def get_active_by_jti(
        self, db: AsyncSession, jti: str
    ) -> AuthRefreshSession | None:
        result = await db.execute(
            select(AuthRefreshSession).where(AuthRefreshSession.jti == jti)
        )
        session = result.scalar_one_or_none()
        if session is None:
            return None
        now = datetime.now(UTC)
        expires_at = session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at <= now:
            await db.delete(session)
            await db.commit()
            return None
        return session

    async def rotate(
        self,
        db: AsyncSession,
        *,
        current: AuthRefreshSession,
        next_jti: str,
        next_expires_at: datetime,
    ) -> AuthRefreshSession:
        await db.delete(current)
        replacement = AuthRefreshSession(
            user_id=current.user_id,
            jti=next_jti,
            expires_at=next_expires_at,
            rotated_at=datetime.now(UTC),
        )
        db.add(replacement)
        await db.commit()
        await db.refresh(replacement)
        return replacement

    async def revoke_all_for_user(self, db: AsyncSession, user_id: int) -> None:
        await db.execute(
            delete(AuthRefreshSession).where(AuthRefreshSession.user_id == user_id)
        )
        await db.commit()

    def build_expiry(self) -> datetime:
        return datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)


auth_refresh_session_crud = AuthRefreshSessionCRUD()