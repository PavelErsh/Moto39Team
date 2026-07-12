"""CRUD-операции для мероприятий."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.schemas.event import EventCreate, EventUpdate


class EventCRUD:
    """Инкапсулирует работу с моделью Event."""

    async def get(self, db: AsyncSession, event_id: int) -> Event | None:
        result = await db.execute(select(Event).where(Event.id == event_id))
        return result.scalar_one_or_none()

    async def list_all(self, db: AsyncSession) -> list[Event]:
        result = await db.execute(
            select(Event).order_by(Event.event_date, Event.id)
        )
        return list(result.scalars().all())

    async def create(
        self,
        db: AsyncSession,
        data: EventCreate,
        created_by: int | None,
    ) -> Event:
        event = Event(created_by=created_by, **data.model_dump())
        db.add(event)
        await db.commit()
        await db.refresh(event)
        return event

    async def update(
        self,
        db: AsyncSession,
        event: Event,
        data: EventUpdate,
    ) -> Event:
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(event, field, value)
        db.add(event)
        await db.commit()
        await db.refresh(event)
        return event

    async def delete(self, db: AsyncSession, event: Event) -> None:
        await db.delete(event)
        await db.commit()


event_crud = EventCRUD()
