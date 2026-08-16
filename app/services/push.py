"""Сервис отправки Web Push-уведомлений через pywebpush."""
import asyncio
import json
import logging
from dataclasses import dataclass

from pywebpush import WebPushException, webpush

from app.core.config import settings
from app.crud.push import get_all_subscriptions, remove_subscription
from app.db.session import AsyncSessionLocal

logger = logging.getLogger(__name__)


@dataclass
class PushPayload:
    """Данные для push-уведомления."""

    title: str
    body: str
    icon: str = "/icon-192.png"
    badge: str = "/icon-192.png"
    tag: str = ""
    url: str = "/"
    badge_count: int | None = None
    # Дополнительные данные, которые попадут в data уведомления
    data: dict | None = None


class PushService:
    """Отправка Web Push-уведомлений (PWA).

    Использует VAPID (Voluntary Application Server Identification)
    для аутентификации на Push Service (FCM для Chrome, Mozilla
    autopush для Firefox и т.д.).

    Требует настроек:
    - VAPID_PRIVATE_KEY
    - VAPID_PUBLIC_KEY (опционально — вычисляется из приватного)
    - VAPID_CLAIMS_EMAIL (email администратора, обычно mailto:...)
    """

    def __init__(self) -> None:
        self._vapid_private_key = settings.VAPID_PRIVATE_KEY
        self._vapid_claims_email = settings.VAPID_CLAIMS_EMAIL
        self._enabled = bool(self._vapid_private_key)
        self._vapid_public_key = ""

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def vapid_public_key(self) -> str:
        """Публичный VAPID-ключ (вычисляется из приватного)."""
        if self._vapid_public_key:
            return self._vapid_public_key
        if not self._vapid_private_key:
            return ""
        try:
            from base64 import urlsafe_b64decode, urlsafe_b64encode

            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric import ec

            # Ключ хранится в формате URL-safe base64(DER).
            # Именно так его генерируют deploy/*.sh скрипты.
            key_bytes = self._vapid_private_key.encode()
            padding_needed = 4 - len(self._vapid_private_key) % 4
            if padding_needed != 4:
                key_bytes += b"=" * padding_needed
            der_bytes = urlsafe_b64decode(key_bytes)
            private = serialization.load_der_private_key(
                der_bytes,
                password=None,
            )
            if not isinstance(private, ec.EllipticCurvePrivateKey):
                return ""

            public_bytes = private.public_key().public_bytes(
                encoding=serialization.Encoding.X962,
                format=serialization.PublicFormat.UncompressedPoint,
            )
            self._vapid_public_key = (
                urlsafe_b64encode(public_bytes)
                .decode("ascii")
                .rstrip("=")
            )
        except Exception:
            pass
        return self._vapid_public_key

    async def send(
        self,
        endpoint: str,
        p256dh: str,
        auth: str,
        payload: PushPayload,
    ) -> bool:
        """Отправить push-уведомление на один endpoint.

        Returns:
            True если отправлено успешно, False если ошибка.
        """
        if not self._enabled:
            logger.debug("Push disabled: no VAPID_PRIVATE_KEY configured")
            return False

        data = json.dumps(
            {
                "title": payload.title,
                "body": payload.body,
                "icon": payload.icon,
                "badge": payload.badge,
                "badgeCount": payload.badge_count,
                "tag": payload.tag,
                "data": {
                    "url": payload.url,
                    **(payload.data or {}),
                },
            },
            ensure_ascii=False,
        )

        try:
            webpush(
                subscription_info={
                    "endpoint": endpoint,
                    "keys": {
                        "p256dh": p256dh,
                        "auth": auth,
                    },
                },
                data=data,
                vapid_private_key=self._vapid_private_key,
                vapid_claims={
                    "sub": self._vapid_claims_email,
                },
                # Таймаут 15 секунд на отправку
                timeout=15,
            )
            return True
        except WebPushException as exc:
            # Если endpoint больше не валиден (410 Gone / 404) —
            # логируем, чтобы вызывающий код мог удалить подписку.
            if hasattr(exc, "response") and exc.response is not None:
                status = getattr(exc.response, "status_code", 0)
                if status in (404, 410):
                    logger.info(
                        "Push subscription expired (HTTP %s): %s",
                        status,
                        endpoint[:80],
                    )
                    raise  # пробрасываем наверх для удаления из БД
            logger.warning("WebPush error for %s: %s", endpoint[:80], exc)
            return False
        except Exception:
            logger.exception("Unexpected push error for %s", endpoint[:80])
            return False

    async def broadcast(self, payload: PushPayload) -> None:
        """Разослать push-уведомление всем сохранённым подпискам.

        Используется для общих событий приложения, например сигналов
        "help" / "sos" / "я катаю" с домашнего экрана.
        Ошибки отдельных подписок не прерывают рассылку остальным.
        """
        if not self._enabled:
            logger.debug("Push broadcast skipped: no VAPID_PRIVATE_KEY configured")
            return

        async with AsyncSessionLocal() as db:
            subs = await get_all_subscriptions(db)
            if not subs:
                return

            async def _send_one(sub) -> None:
                try:
                    await self.send(
                        endpoint=sub.endpoint,
                        p256dh=sub.p256dh,
                        auth=sub.auth,
                        payload=payload,
                    )
                except WebPushException as exc:
                    response = getattr(exc, "response", None)
                    status = getattr(response, "status_code", 0)
                    if status in (404, 410):
                        await remove_subscription(db, sub.endpoint)
                except Exception:
                    logger.exception(
                        "Unexpected push broadcast error for %s",
                        sub.endpoint[:80],
                    )

            await asyncio.gather(*[_send_one(sub) for sub in subs], return_exceptions=True)


# Глобальный экземпляр сервиса
push_service = PushService()
