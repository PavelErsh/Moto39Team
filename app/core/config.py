"""Конфигурация приложения на основе переменных окружения."""
from functools import lru_cache
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Настройки приложения."""

    APP_NAME: str = "Moto39Team"
    APP_ENV: str = "development"
    DEBUG: bool = True

    DATABASE_URL: str = "sqlite+aiosqlite:///./app.db"

    # Каталог для загружаемых файлов (изображения справочника и т.п.).
    # Раздаётся по префиксу /media (см. app/main.py).
    UPLOAD_DIR: str = "uploads"

    SECRET_KEY: str = "change-me-to-a-long-random-secret"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS: список разрешённых origin через запятую или '*' — разрешить все.
    # По умолчанию — типовые локальные порты Vite (dev/preview).
    #
    # ВАЖНО: `NoDecode` отключает автоматический JSON-парсинг значения из
    # переменных окружения (pydantic-settings v2 иначе пытается json.loads()
    # ДО валидаторов и падает на строке вида "a,b,c"). С NoDecode значение
    # приходит в валидатор _split_cors как есть — и корректно бьётся по
    # запятой.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]
    # Регулярка для origin: по умолчанию разрешаем любой localhost/127.0.0.1
    # с любым портом — удобно при работе Vite (5173/5174/5175/…).
    CORS_ORIGIN_REGEX: str = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_cors(cls, v: object) -> object:
        """Позволяет задавать CORS_ORIGINS строкой через запятую в .env."""
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            if s == "*":
                return ["*"]
            return [item.strip() for item in s.split(",") if item.strip()]
        return v

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
