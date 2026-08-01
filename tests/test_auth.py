"""Базовые тесты авторизации.

В тестовом окружении (см. conftest.py) верификация email и капча
отключены — поэтому /auth/register сразу создаёт пользователя.
Отдельно проверяем полный сценарий с кодом подтверждения через
monkeypatch настроек и мок отправки email.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.api.v1 import auth as auth_module
from app.core.config import settings
from app.main import app


@pytest.mark.asyncio
async def test_health() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test"
    ) as ac:
        response = await ac.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


@pytest.mark.asyncio
async def test_auth_config_endpoint() -> None:
    """Публичный /auth/config отдаёт флаги для фронта."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test"
    ) as ac:
        r = await ac.get("/api/v1/auth/config")
    assert r.status_code == 200
    body = r.json()
    for key in (
        "turnstile_enabled",
        "turnstile_site_key",
        "email_verification_enabled",
        "email_code_length",
        "email_code_ttl_minutes",
    ):
        assert key in body


@pytest.mark.asyncio
async def test_register_and_login() -> None:
    """Быстрый путь: EMAIL_VERIFICATION_ENABLED=False (см. conftest)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test"
    ) as ac:
        payload = {
            "email": "test@example.com",
            "username": "testuser",
            "password": "strongpass123",
            "full_name": "Test User",
        }
        r = await ac.post("/api/v1/auth/register", json=payload)
        # 202 — успешный старт регистрации (в тестах email verification
        # отключена, поэтому пользователь создан сразу).
        # 400 — если тест перезапускается на уже занятом email.
        assert r.status_code in (202, 400)

        r = await ac.post(
            "/api/v1/auth/login",
            data={
                "username": "testuser",
                "password": "strongpass123",
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded"
            },
        )
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data
        assert "refresh_token" in data

        access = data["access_token"]
        r = await ac.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {access}"},
        )
        assert r.status_code == 200
        assert r.json()["username"] == "testuser"


@pytest.mark.asyncio
async def test_email_verification_flow(monkeypatch) -> None:
    """Сценарий с кодом: register → verify-email → login-токены."""
    # Временно включаем email verification и подменяем отправку письма
    # так, чтобы просто запомнить сгенерированный код.
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_ENABLED", True)

    sent: dict[str, str] = {}

    async def _fake_send(to_email: str, code: str) -> None:
        sent["email"] = to_email
        sent["code"] = code

    # Подменяем в модуле, где функция реально используется —
    # ``app.api.v1.auth`` импортирует её через ``from ... import``.
    monkeypatch.setattr(auth_module, "send_verification_code", _fake_send)

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test"
    ) as ac:
        payload = {
            "email": "verify@example.com",
            "username": "verifyuser",
            "password": "strongpass123",
            "full_name": "Verify User",
        }
        r = await ac.post("/api/v1/auth/register", json=payload)
        assert r.status_code == 202, r.text
        assert sent.get("email") == "verify@example.com"
        code = sent["code"]

        # Неверный код должен вернуть 400.
        r_bad = await ac.post(
            "/api/v1/auth/verify-email",
            json={"email": "verify@example.com", "code": "000000"},
        )
        assert r_bad.status_code == 400

        # Правильный код: получаем пару токенов и работающий /me.
        r_ok = await ac.post(
            "/api/v1/auth/verify-email",
            json={"email": "verify@example.com", "code": code},
        )
        assert r_ok.status_code == 200, r_ok.text
        tokens = r_ok.json()
        assert "access_token" in tokens
        assert "refresh_token" in tokens

        r_me = await ac.get(
            "/api/v1/auth/me",
            headers={
                "Authorization": f"Bearer {tokens['access_token']}"
            },
        )
        assert r_me.status_code == 200
        assert r_me.json()["email"] == "verify@example.com"
