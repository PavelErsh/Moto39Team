"""API для push-подписок."""
import logging

from fastapi import APIRouter

from app.api.deps import CurrentActiveUser, DbSession
from app.crud.push import (
    get_subscriptions_for_user,
    remove_subscription,
    save_subscription,
)
from app.schemas.push import PushSubscriptionCreate
from app.services.push import push_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key")
async def get_vapid_public_key() -> dict:
    """Получить VAPID public key для фронтенда."""
    return {"key": push_service.vapid_public_key}


@router.post("/subscribe", status_code=201)
async def subscribe(
    data: PushSubscriptionCreate,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> dict:
    """Подписать пользователя на Web Push-уведомления."""
    await save_subscription(
        db,
        user_id=current_user.id,
        endpoint=data.endpoint,
        p256dh=data.p256dh,
        auth=data.auth,
        user_agent=data.user_agent,
    )
    return {"ok": True}


@router.post("/unsubscribe")
async def unsubscribe(
    data: PushSubscriptionCreate,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> dict:
    """Отписать пользователя от Web Push-уведомлений."""
    await remove_subscription(db, endpoint=data.endpoint)
    return {"ok": True}


@router.get("/subscriptions")
async def list_subscriptions(
    db: DbSession,
    current_user: CurrentActiveUser,
) -> list[dict]:
    """Список push-подписок текущего пользователя."""
    subs = await get_subscriptions_for_user(db, user_id=current_user.id)
    return [
        {
            "id": s.id,
            "endpoint": s.endpoint,
            "user_agent": s.user_agent,
            "created_at": s.created_at.isoformat(),
        }
        for s in subs
    ]
