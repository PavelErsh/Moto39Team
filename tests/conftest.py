"""Общие фикстуры pytest.

Тесты **никогда** не должны трогать dev/production БД, поэтому здесь мы
подменяем переменную окружения `DATABASE_URL` на отдельный файл
`test.db` ещё до того, как приложение импортирует настройки. Файл
создаётся с нуля перед тестами и удаляется после, а `app.db` остаётся
нетронутым.
"""
from __future__ import annotations

import asyncio
import os
import pathlib

import pytest

# Важно: подменить URL БД ДО первого импорта app.* — иначе Settings
# закешируется с продовым/дев значением через @lru_cache.
_TEST_DB_PATH = pathlib.Path(__file__).resolve().parent.parent / "test.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB_PATH}"
# По умолчанию в тестах выключаем внешние зависимости регистрации:
# капчу Cloudflare и отправку email. Отдельные тесты могут при желании
# включить их обратно через monkeypatch settings.
os.environ.setdefault("TURNSTILE_ENABLED", "False")
os.environ.setdefault("EMAIL_VERIFICATION_ENABLED", "False")
os.environ.setdefault("EMAIL_CONSOLE_FALLBACK", "True")


# Импортируем ПОСЛЕ подмены переменной окружения.
from app.db import base_all  # noqa: E402, F401  # регистрирует модели
from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@pytest.fixture(scope="session", autouse=True)
def create_test_db():
    """Создать таблицы в отдельной test.db перед тестами и удалить после."""

    async def _create() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    async def _drop() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    _run(_create())
    yield
    _run(_drop())
    # Подчистим файл тестовой БД, чтобы не мусорить в репозитории.
    try:
        _TEST_DB_PATH.unlink(missing_ok=True)
    except OSError:
        pass
