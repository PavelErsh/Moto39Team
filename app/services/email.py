"""Отправка e-mail через SMTP (aiosmtplib).

Используется для рассылки кодов подтверждения при регистрации. Если
SMTP-хост не настроен и включён ``EMAIL_CONSOLE_FALLBACK`` — код просто
печатается в лог. Это удобно для локальной разработки: не нужно
поднимать почтовый сервер, а код видно в консоли backend'а.
"""
from __future__ import annotations

import logging
import secrets
from email.message import EmailMessage
from email.utils import formataddr

import aiosmtplib

from app.core.config import settings

logger = logging.getLogger(__name__)


def generate_code(length: int | None = None) -> str:
    """Сгенерировать N-значный цифровой код подтверждения."""
    n = length or settings.EMAIL_CODE_LENGTH
    # secrets.randbelow даёт равномерное распределение без предсказуемости.
    max_value = 10**n
    return str(secrets.randbelow(max_value)).zfill(n)


def _build_message(to_email: str, code: str) -> EmailMessage:
    """Собрать MIME-письмо с кодом подтверждения (plain + html)."""
    ttl = settings.EMAIL_CODE_TTL_MINUTES
    app_name = settings.APP_NAME

    msg = EmailMessage()
    msg["Subject"] = f"Код подтверждения {app_name}: {code}"
    msg["From"] = formataddr((settings.SMTP_FROM_NAME, settings.SMTP_FROM_EMAIL))
    msg["To"] = to_email

    text = (
        f"Здравствуйте!\n\n"
        f"Ваш код подтверждения регистрации в {app_name}: {code}\n"
        f"Код действует {ttl} минут.\n\n"
        f"Если вы не запрашивали регистрацию, просто игнорируйте это письмо."
    )
    msg.set_content(text)

    html = f"""
    <div style="font-family: Arial, sans-serif; color:#222;">
      <h2 style="margin:0 0 12px;">Подтверждение регистрации</h2>
      <p>Здравствуйте! Спасибо, что регистрируетесь в
      <b>{app_name}</b>.</p>
      <p>Ваш код подтверждения:</p>
      <p style="font-size:28px; font-weight:bold; letter-spacing:6px;
               background:#f2f2f2; padding:12px 20px; display:inline-block;
               border-radius:8px;">
        {code}
      </p>
      <p>Код действует <b>{ttl} минут</b>. Если вы не запрашивали
      регистрацию, просто проигнорируйте это письмо.</p>
    </div>
    """
    msg.add_alternative(html, subtype="html")
    return msg


async def send_verification_code(to_email: str, code: str) -> None:
    """Отправить письмо с кодом подтверждения.

    Если SMTP не настроен и включён ``EMAIL_CONSOLE_FALLBACK`` — просто
    напечатать код в лог (dev-режим).
    """
    from_email = settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME
    host = settings.SMTP_HOST

    if not host or not from_email:
        if settings.EMAIL_CONSOLE_FALLBACK:
            logger.warning(
                "[email fallback] SMTP не настроен. "
                "Код подтверждения для %s: %s",
                to_email,
                code,
            )
            return
        raise RuntimeError(
            "SMTP не настроен. Задайте SMTP_HOST/SMTP_FROM_EMAIL или "
            "включите EMAIL_CONSOLE_FALLBACK."
        )

    message = _build_message(to_email, code)
    # Заполняем From, если ранее его подставили из USERNAME.
    if not settings.SMTP_FROM_EMAIL:
        message.replace_header(
            "From", formataddr((settings.SMTP_FROM_NAME, from_email))
        )

    try:
        await aiosmtplib.send(
            message,
            hostname=host,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USERNAME or None,
            password=settings.SMTP_PASSWORD or None,
            start_tls=settings.SMTP_USE_STARTTLS,
            use_tls=settings.SMTP_USE_TLS,
            timeout=15,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось отправить письмо на %s", to_email)
        if settings.EMAIL_CONSOLE_FALLBACK:
            logger.warning(
                "[email fallback] SMTP упал. Код для %s: %s",
                to_email,
                code,
            )
            return
        raise
