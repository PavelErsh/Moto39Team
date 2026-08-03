"""CRUD-операции для статей мотосправки."""
import re

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reference import Reference
from app.schemas.reference import ReferenceCreate, ReferenceUpdate


# Транслитерация кириллицы для авто-генерации slug.
_RU_MAP: dict[str, str] = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def slugify(value: str) -> str:
    """Приводит произвольную строку к slug: [a-z0-9-]+.

    Транслитерирует кириллицу, всё остальное — в дефисы, обрезает до 160
    символов. Если результат пустой — возвращает 'article'.
    """
    text = (value or "").strip().lower()
    text = "".join(_RU_MAP.get(ch, ch) for ch in text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    text = text[:160].strip("-")
    return text or "article"


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

    async def _make_unique_slug(
        self, db: AsyncSession, base: str
    ) -> str:
        """Возвращает уникальный slug на основе base.

        Если base уже занят — добавляет числовой суффикс: `slug-2`, `slug-3`
        и т.д. Учитывает ограничение длины поля (160 символов).
        """
        base = slugify(base)
        candidate = base
        suffix = 2
        while await self.get_by_slug(db, candidate) is not None:
            tail = f"-{suffix}"
            trimmed_base = base[: max(1, 160 - len(tail))]
            candidate = f"{trimmed_base}{tail}"
            suffix += 1
        return candidate

    async def create(
        self,
        db: AsyncSession,
        data: ReferenceCreate,
        created_by: int | None,
    ) -> Reference:
        payload = data.model_dump()
        # slug приходит опционально: если пуст — генерируем из title,
        # затем гарантируем уникальность добавлением суффикса.
        raw_slug = payload.pop("slug", None)
        base_slug = raw_slug if raw_slug else payload["title"]
        payload["slug"] = await self._make_unique_slug(db, base_slug)

        ref = Reference(created_by=created_by, **payload)
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
