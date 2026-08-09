"""CRUD для Push-подписок."""
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.push_subscription import PushSubscription


async def save_subscription(
    db: AsyncSession,
    user_id: int,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None = None,
) -> PushSubscription:
    """Сохранить или обновить push-подписку пользователя.

    Для одного endpoint может быть только одна запись — если пользователь
    переподписывается (например, после смены ключей), старая заменяется.
    """
    # Удаляем старую подписку с таким же endpoint (если есть)
    stmt = delete(PushSubscription).where(PushSubscription.endpoint == endpoint)
    await db.execute(stmt)

    sub = PushSubscription(
        user_id=user_id,
        endpoint=endpoint,
        p256dh=p256dh,
        auth=auth,
        user_agent=user_agent,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


async def remove_subscription(
    db: AsyncSession,
    endpoint: str,
) -> bool:
    """Удалить push-подписку по endpoint. Возвращает True если была удалена."""
    stmt = delete(PushSubscription).where(PushSubscription.endpoint == endpoint)
    result = await db.execute(stmt)
    await db.commit()
    return result.rowcount > 0


async def get_subscriptions_for_user(
    db: AsyncSession,
    user_id: int,
) -> list[PushSubscription]:
    """Получить все push-подписки пользователя."""
    stmt = (
        select(PushSubscription)
        .where(PushSubscription.user_id == user_id)
        .order_by(PushSubscription.created_at.desc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_all_subscriptions(
    db: AsyncSession,
) -> list[PushSubscription]:
    """Получить все push-подписки (для рассылки)."""
    result = await db.execute(select(PushSubscription))
    return list(result.scalars().all())
