"""CRUD-операции для мотоцикла."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.motorcycle import Motorcycle
from app.schemas.motorcycle import MotorcycleCreate, MotorcycleUpdate


class MotorcycleCRUD:
    """Инкапсулирует работу с моделью Motorcycle."""

    @staticmethod
    def _normalize_photo_fields(data: dict) -> dict:
        photos = data.get("photos")
        photo_url = data.get("photo_url")

        if photos is not None:
            normalized: list[str] = []
            seen: set[str] = set()
            for item in photos:
                if not isinstance(item, str):
                    continue
                url = item.strip()
                if not url or url in seen:
                    continue
                normalized.append(url)
                seen.add(url)
            data["photos"] = normalized
            data["photo_url"] = normalized[0] if normalized else None
            return data

        if photo_url is not None:
            url = photo_url.strip() if isinstance(photo_url, str) else None
            data["photo_url"] = url or None
            data["photos"] = [url] if url else []

        return data

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
        payload = self._normalize_photo_fields(data.model_dump())
        moto = Motorcycle(user_id=user_id, **payload)
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
        update_data = self._normalize_photo_fields(
            data.model_dump(exclude_unset=True)
        )
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
