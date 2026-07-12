"""CRUD-операции для мотоцикла."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.motorcycle import Motorcycle
from app.schemas.motorcycle import MotorcycleCreate, MotorcycleUpdate


class MotorcycleCRUD:
    """Инкапсулирует работу с моделью Motorcycle."""

    async def get(self, db: AsyncSession, moto_id: int) -> Motorcycle | None:
        result = await db.execute(
            select(Motorcycle).where(Motorcycle.id == moto_id)
        )
        return result.scalar_one_or_none()

    async def list_by_user(
        self, db: AsyncSession, user_id: int
    ) -> list[Motorcycle]:
        result = await db.execute(
            select(Motorcycle)
            .where(Motorcycle.user_id == user_id)
            .order_by(Motorcycle.created_at)
        )
        return list(result.scalars().all())

    async def create(
        self, db: AsyncSession, user_id: int, data: MotorcycleCreate
    ) -> Motorcycle:
        moto = Motorcycle(user_id=user_id, **data.model_dump())
        db.add(moto)
        await db.commit()
        await db.refresh(moto)
        return moto

    async def update(
        self,
        db: AsyncSession,
        moto: Motorcycle,
        data: MotorcycleUpdate,
    ) -> Motorcycle:
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(moto, field, value)
        db.add(moto)
        await db.commit()
        await db.refresh(moto)
        return moto

    async def delete(self, db: AsyncSession, moto: Motorcycle) -> None:
        await db.delete(moto)
        await db.commit()


motorcycle_crud = MotorcycleCRUD()
