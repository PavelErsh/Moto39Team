"""Точка входа FastAPI-приложения (чистый REST API для React-фронтенда)."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.db import base_all  # noqa: F401  # регистрирует все модели


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version="0.1.0",
        description=(
            "REST API для Moto39Team. Авторизация — JWT (Bearer). "
            "Схема БД управляется через Alembic (см. `migrations/`)."
        ),
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
