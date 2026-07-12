"""Базовые тесты авторизации."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_health() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


@pytest.mark.asyncio
async def test_register_and_login() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        payload = {
            "email": "test@example.com",
            "username": "testuser",
            "password": "strongpass123",
            "full_name": "Test User",
        }
        r = await ac.post("/api/v1/auth/register", json=payload)
        assert r.status_code in (201, 400)  # 400, если тест запускается повторно

        r = await ac.post(
            "/api/v1/auth/login",
            data={"username": "testuser", "password": "strongpass123"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
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
