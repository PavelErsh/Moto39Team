"""Базовые тесты авторизации.

В тестовом окружении (см. conftest.py) верификация email и капча
отключены — поэтому /auth/register сразу создаёт пользователя.
Отдельно проверяем полный сценарий с кодом подтверждения через
monkeypatch настроек и мок отправки email.
"""
import asyncio

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
async def test_refresh_token_rotation() -> None:
    """Refresh-сессия «скользит»: тот же refresh-токен остаётся валиден.

    Раньше при каждом /auth/refresh мы ротировали jti и инвалидировали
    старый refresh. Это ломало параллельные запросы (несколько вкладок,
    service worker, background-геолокация): один запрос уже проротировал
    сессию, второй с тем же (ещё вчера валидным) refresh получал 401 и
    выкидывал пользователя. Теперь /auth/refresh возвращает новый access
    и оставляет refresh прежним, продлевая срок жизни сессии.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test"
    ) as ac:
        payload = {
            "email": "refresh@example.com",
            "username": "refreshuser",
            "password": "strongpass123",
            "full_name": "Refresh User",
        }
        r_register = await ac.post("/api/v1/auth/register", json=payload)
        assert r_register.status_code == 202, r_register.text

        r_login = await ac.post(
            "/api/v1/auth/login",
            data={"username": "refreshuser", "password": "strongpass123"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert r_login.status_code == 200, r_login.text
        tokens_1 = r_login.json()

        r_refresh = await ac.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": tokens_1["refresh_token"]},
        )
        assert r_refresh.status_code == 200, r_refresh.text
        tokens_2 = r_refresh.json()
        # Refresh не ротируется — это осознанное поведение (см. docstring).
        assert tokens_2["refresh_token"] == tokens_1["refresh_token"]
        # Access-токен обязан быть свежим.
        assert tokens_2["access_token"]

        r_me = await ac.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {tokens_2['access_token']}"},
        )
        assert r_me.status_code == 200, r_me.text
        assert r_me.json()["username"] == "refreshuser"

        # Старый refresh должен и дальше работать — иначе параллельные
        # запросы (SW/вкладки) снова начнут выкидывать пользователя.
        r_reuse = await ac.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": tokens_1["refresh_token"]},
        )
        assert r_reuse.status_code == 200, r_reuse.text

        r_refresh_again = await ac.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": tokens_2["refresh_token"]},
        )
        assert r_refresh_again.status_code == 200, r_refresh_again.text


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


@pytest.mark.asyncio
async def test_concurrent_registration_same_email() -> None:
    """Две параллельные регистрации на один email не создают двух юзеров.

    Именно эта гонка приводила к тому, что «пользователи попадали на
    чужие аккаунты»: обе конкурирующие транзакции успевали пройти
    проверку уникальности до insert'а, а вторая падала с 500 (Integrity
    Error) уже после того, как первая создавала запись. Мы ждём, что
    один запрос завершится 202 (принят), а второй получит осмысленный
    409 (или 400 — если наш пре-check оказался быстрее второго),
    но никак не 500.
    """
    transport = ASGITransport(app=app)
    payload_a = {
        "email": "race@example.com",
        "username": "raceuser_a",
        "password": "strongpass123",
        "full_name": "Race A",
    }
    payload_b = {
        # Тот же email в другом регистре — раньше это позволяло обойти
        # проверку уникальности, потому что БД считает 'Race@…' и
        # 'race@…' разными строками.
        "email": "Race@example.com",
        "username": "raceuser_b",
        "password": "strongpass123",
        "full_name": "Race B",
    }

    async with AsyncClient(
        transport=transport, base_url="http://test"
    ) as ac:
        r_a, r_b = await asyncio.gather(
            ac.post("/api/v1/auth/register", json=payload_a),
            ac.post("/api/v1/auth/register", json=payload_b),
        )

    statuses = sorted([r_a.status_code, r_b.status_code])
    # Один успех — второй должен быть отвергнут; ни одного 5xx быть
    # не должно.
    assert 202 in statuses
    assert statuses[1] in (400, 409), (r_a.text, r_b.text)
    assert all(200 <= s < 500 for s in statuses)


@pytest.mark.asyncio
async def test_register_normalizes_email_case() -> None:
    """Регистрация двух разных регистров одного email — конфликт."""
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test"
    ) as ac:
        r1 = await ac.post(
            "/api/v1/auth/register",
            json={
                "email": "MixedCase@example.com",
                "username": "mixed_a",
                "password": "strongpass123",
                "full_name": "A",
            },
        )
        assert r1.status_code == 202, r1.text

        r2 = await ac.post(
            "/api/v1/auth/register",
            json={
                "email": "mixedcase@example.com",
                "username": "mixed_b",
                "password": "strongpass123",
                "full_name": "B",
            },
        )
        # Пре-check ловит совпадение по нормализованному email.
        assert r2.status_code in (400, 409), r2.text


@pytest.mark.asyncio
async def test_password_reset_flow(monkeypatch) -> None:
    """Запрос кода восстановления → смена пароля → вход новым паролем."""
    sent: dict[str, str] = {}

    async def _fake_send(to_email: str, code: str) -> None:
        sent["email"] = to_email
        sent["code"] = code

    monkeypatch.setattr(auth_module, "send_password_reset_code", _fake_send)

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test"
    ) as ac:
        register_payload = {
            "email": "reset@example.com",
            "username": "resetuser",
            "password": "oldpass123",
            "full_name": "Reset User",
        }
        r_register = await ac.post("/api/v1/auth/register", json=register_payload)
        assert r_register.status_code == 202, r_register.text

        r_forgot = await ac.post(
            "/api/v1/auth/forgot-password",
            json={"email": "reset@example.com"},
        )
        assert r_forgot.status_code == 202, r_forgot.text
        assert sent["email"] == "reset@example.com"
        code = sent["code"]

        r_bad = await ac.post(
            "/api/v1/auth/reset-password",
            json={
                "email": "reset@example.com",
                "code": "000000",
                "new_password": "newpass123",
            },
        )
        assert r_bad.status_code == 400

        r_ok = await ac.post(
            "/api/v1/auth/reset-password",
            json={
                "email": "reset@example.com",
                "code": code,
                "new_password": "newpass123",
            },
        )
        assert r_ok.status_code == 200, r_ok.text

        r_old_login = await ac.post(
            "/api/v1/auth/login",
            data={"username": "resetuser", "password": "oldpass123"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert r_old_login.status_code == 401

        r_new_login = await ac.post(
            "/api/v1/auth/login",
            data={"username": "resetuser", "password": "newpass123"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert r_new_login.status_code == 200, r_new_login.text


@pytest.mark.asyncio
async def test_forgot_password_does_not_leak_user_existence(monkeypatch) -> None:
    """Для отсутствующего email ручка возвращает тот же 202-ответ."""

    async def _fake_send(to_email: str, code: str) -> None:
        raise AssertionError(f"send should not be called for unknown email {to_email} {code}")

    monkeypatch.setattr(auth_module, "send_password_reset_code", _fake_send)

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test"
    ) as ac:
        r = await ac.post(
            "/api/v1/auth/forgot-password",
            json={"email": "missing@example.com"},
        )
        assert r.status_code == 202
        body = r.json()
        assert body["email"] == "missing@example.com"
        assert "письмо отправлено" in body["message"].lower()
