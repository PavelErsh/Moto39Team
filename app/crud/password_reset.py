"""CRUD-операции для одноразовых кодов сброса пароля."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.password_reset import PasswordResetCode


class PasswordResetCRUD:
    """Работа с кодами сброса пароля."""

    async def get_active_by_email(
        self, db: AsyncSession, email: str
    ) -> PasswordResetCode | None:
        result = await db.execute(
            select(PasswordResetCode)
            .where(PasswordResetCode.email == email)
            .order_by(PasswordResetCode.created_at.desc())
        )
        return result.scalars().first()

    async def delete_by_email(self, db: AsyncSession, email: str) -> None:
        await db.execute(
            delete(PasswordResetCode).where(PasswordResetCode.email == email)
        )
        await db.commit()

    async def create(
        self,
        db: AsyncSession,
        *,
        email: str,
        code: str,
    ) -> PasswordResetCode:
        await db.execute(
            delete(PasswordResetCode).where(PasswordResetCode.email == email)
        )
        now = datetime.now(timezone.utc)
        obj = PasswordResetCode(
            email=email,
            code=code,
            attempts=0,
            expires_at=now
            + timedelta(minutes=settings.EMAIL_CODE_TTL_MINUTES),
            last_sent_at=now,
        )
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
        return obj

    async def update_code(
        self,
        db: AsyncSession,
        obj: PasswordResetCode,
        *,
        code: str,
    ) -> PasswordResetCode:
        now = datetime.now(timezone.utc)
        obj.code = code
        obj.attempts = 0
        obj.last_sent_at = now
        obj.expires_at = now + timedelta(minutes=settings.EMAIL_CODE_TTL_MINUTES)
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
        return obj

    async def increment_attempts(
        self, db: AsyncSession, obj: PasswordResetCode
    ) -> PasswordResetCode:
        obj.attempts += 1
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
        return obj


password_reset_crud = PasswordResetCRUD()