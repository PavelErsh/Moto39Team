"""Push-подписки — схемы."""

from pydantic import BaseModel


class PushSubscriptionCreate(BaseModel):
    """Создание/обновление push-подписки."""

    endpoint: str
    p256dh: str
    auth: str
    user_agent: str | None = None

