"""Точка входа FastAPI-приложения (чистый REST API для React-фронтенда)."""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.crud import chat as chat_crud
from app.db import base_all  # noqa: F401  # регистрирует все модели
from app.db.session import AsyncSessionLocal
from app.services.event_reminders import reminders_loop
from app.services.ws_manager import close_redis, init_redis

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Инициализация и очистка ресурсов при старте/остановке приложения."""
    reminder_task: asyncio.Task | None = None
    try:
        async with AsyncSessionLocal() as db:
            await chat_crud.purge_expired_chat_images(db, force=True, min_interval_seconds=0)
    except Exception:
        logger.exception("Failed to purge expired chat images on startup")

    # Инициализация Redis Pub/Sub (для чата)
    try:
        await init_redis(settings.REDIS_URL)
        logger.info("Redis Pub/Sub initialized")
    except Exception:
        logger.warning("Redis not available — chat will use in-process messaging")

    try:
        reminder_task = asyncio.create_task(reminders_loop())
        logger.info("Event reminders loop started")
    except Exception:
        logger.exception("Failed to start event reminders loop")
    yield
    # Очистка
    if reminder_task:
        reminder_task.cancel()
        try:
            await reminder_task
        except asyncio.CancelledError:
            pass
    try:
        await close_redis()
    except Exception:
        pass


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version="0.1.0",
        description=(
            "REST API для Moto39Team. Авторизация — JWT (Bearer). "
            "Схема БД управляется через Alembic (см. `migrations/`)."
        ),
        lifespan=lifespan,
    )

    # CORS для React dev-сервера (Vite: 5173/5174/5175 и т.п.)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_origin_regex=settings.CORS_ORIGIN_REGEX,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix="/api/v1")

    # Раздача загруженных файлов (изображения справочника и т.п.)
    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/media",
        StaticFiles(directory=str(upload_dir)),
        name="media",
    )

    @app.get("/", tags=["root"])
    async def root() -> dict[str, str]:
        return {
            "app": settings.APP_NAME,
            "docs": "/docs",
            "api": "/api/v1",
        }

    @app.get("/health", tags=["root"])
    async def health() -> dict[str, str]:
        return {"status": "healthy"}

    return app


app = create_app()
