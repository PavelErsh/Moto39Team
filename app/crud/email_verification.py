"""CRUD-операции для кодов подтверждения e-mail."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.email_verification import EmailVerificationCode


class EmailVerificationCRUD:
    """Работа с одноразовыми кодами подтверждения email."""

    async def get_active_by_email(
        self, db: AsyncSession, email: str
    ) -> EmailVerificationCode | None:
        result = await db.execute(
            select(EmailVerificationCode)
            .where(EmailVerificationCode.email == email)
            .order_by(EmailVerificationCode.created_at.desc())
        )
        return result.scalars().first()

    async def delete_by_email(self, db: AsyncSession, email: str) -> None:
        await db.execute(
            delete(EmailVerificationCode).where(
                EmailVerificationCode.email == email
            )
        )
        await db.commit()

    async def create(
        self,
        db: AsyncSession,
        *,
        email: str,
        username: str,
        full_name: str | None,
        hashed_password: str,
        code: str,
    ) -> EmailVerificationCode:
        # Удаляем предыдущие черновики для этого email, чтобы был всегда
        # только один актуальный.
        await db.execute(
            delete(EmailVerificationCode).where(
                EmailVerificationCode.email == email
            )
        )
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(
            minutes=settings.EMAIL_CODE_TTL_MINUTES
        )
        obj = EmailVerificationCode(
            email=email,
            username=username,
            full_name=full_name,
            hashed_password=hashed_password,
            code=code,
            attempts=0,
            expires_at=expires_at,
            last_sent_at=now,
        )
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
        return obj

    async def update_code(
        self,
        db: AsyncSession,
        obj: EmailVerificationCode,
        *,
        code: str,
    ) -> EmailVerificationCode:
        now = datetime.now(timezone.utc)
        obj.code = code
        obj.attempts = 0
        obj.last_sent_at = now
        obj.expires_at = now + timedelta(
            minutes=settings.EMAIL_CODE_TTL_MINUTES
        )
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
        return obj

    async def increment_attempts(
        self, db: AsyncSession, obj: EmailVerificationCode
    ) -> EmailVerificationCode:
        obj.attempts += 1
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
        return obj


email_verification_crud = EmailVerificationCRUD()
