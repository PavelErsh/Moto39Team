"""Проверка токена Cloudflare Turnstile.

Turnstile — это капча-заменитель от Cloudflare. На фронте виджет
получает site-key и возвращает одноразовый токен, который бэкенд
проверяет через siteverify. Документация:
https://developers.cloudflare.com/turnstile/
"""
from __future__ import annotations

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


async def verify_turnstile_token(
    token: str | None, remote_ip: str | None = None
) -> bool:
    """Проверить токен капчи через Cloudflare siteverify.

    Возвращает True, если проверка пройдена. Если ``TURNSTILE_ENABLED``
    выключен — сразу возвращаем True (капча не требуется).
    """
    if not settings.TURNSTILE_ENABLED:
        return True
    if not settings.TURNSTILE_SECRET_KEY:
        logger.warning(
            "TURNSTILE_ENABLED=True, но TURNSTILE_SECRET_KEY не задан. "
            "Пропускаем проверку капчи."
        )
        return True
    if not token:
        return False

    data = {"secret": settings.TURNSTILE_SECRET_KEY, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(settings.TURNSTILE_VERIFY_URL, data=data)
        resp.raise_for_status()
        payload = resp.json()
    except Exception:  # noqa: BLE001
        logger.exception("Cloudflare Turnstile verify: сетевая ошибка")
        return False

    success = bool(payload.get("success"))
    if not success:
        logger.warning(
            "Turnstile verify отклонил токен: %s",
            payload.get("error-codes"),
        )
    return success
