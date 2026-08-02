"""CRUD-операции для событий (раздел «События» /rides)."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ride import Ride
from app.schemas.ride import RideCreate, RideUpdate


class RideCRUD:
    """Инкапсулирует работу с моделью Ride."""

    async def get(self, db: AsyncSession, ride_id: int) -> Ride | None:
        result = await db.execute(select(Ride).where(Ride.id == ride_id))
        return result.scalar_one_or_none()

    async def list_all(self, db: AsyncSession) -> list[Ride]:
        result = await db.execute(
            select(Ride).order_by(Ride.event_date, Ride.id)
        )
        return list(result.scalars().all())

    async def create(
        self,
        db: AsyncSession,
        data: RideCreate,
        created_by: int | None,
    ) -> Ride:
        ride = Ride(created_by=created_by, **data.model_dump())
        db.add(ride)
        await db.commit()
        await db.refresh(ride)
        return ride

    async def update(
        self,
        db: AsyncSession,
        ride: Ride,
        data: RideUpdate,
    ) -> Ride:
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(ride, field, value)
        db.add(ride)
        await db.commit()
        await db.refresh(ride)
        return ride

    async def delete(self, db: AsyncSession, ride: Ride) -> None:
        await db.delete(ride)
        await db.commit()


ride_crud = RideCRUD()
