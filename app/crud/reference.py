"""CRUD-операции для статей мотосправки."""
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reference import Reference
from app.schemas.reference import ReferenceCreate, ReferenceUpdate


class ReferenceCRUD:
    """Инкапсулирует работу с моделью Reference."""

    async def get(self, db: AsyncSession, ref_id: int) -> Reference | None:
        result = await db.execute(
            select(Reference).where(Reference.id == ref_id)
        )
        return result.scalar_one_or_none()

    async def get_by_slug(
        self, db: AsyncSession, slug: str
    ) -> Reference | None:
        result = await db.execute(
            select(Reference).where(Reference.slug == slug)
        )
        return result.scalar_one_or_none()

    async def get_by_id_or_slug(
        self, db: AsyncSession, key: str
    ) -> Reference | None:
        conditions = [Reference.slug == key]
        try:
            conditions.append(Reference.id == int(key))
        except (TypeError, ValueError):
            pass
        result = await db.execute(select(Reference).where(or_(*conditions)))
        return result.scalars().first()

    async def list_all(self, db: AsyncSession) -> list[Reference]:
        result = await db.execute(
            select(Reference).order_by(Reference.category, Reference.title)
        )
        return list(result.scalars().all())

    async def create(
        self,
        db: AsyncSession,
        data: ReferenceCreate,
        created_by: int | None,
    ) -> Reference:
        ref = Reference(created_by=created_by, **data.model_dump())
        db.add(ref)
        await db.commit()
        await db.refresh(ref)
        return ref

    async def update(
        self,
        db: AsyncSession,
        ref: Reference,
        data: ReferenceUpdate,
    ) -> Reference:
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(ref, field, value)
        db.add(ref)
        await db.commit()
        await db.refresh(ref)
        return ref

    async def delete(self, db: AsyncSession, ref: Reference) -> None:
        await db.delete(ref)
        await db.commit()


reference_crud = ReferenceCRUD()
