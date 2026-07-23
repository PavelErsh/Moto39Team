"""Конфигурация приложения на основе переменных окружения."""
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Значения по умолчанию для CORS — типовые локальные порты Vite (dev/preview).
_DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]


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
    #
    # Важно: держим тип как `str`, а не `list[str]`. В pydantic-settings v2
    # для полей list[...] значение из env автоматически прогоняется через
    # json.loads() ДО валидаторов, из-за чего значение вида
    # "https://a,https://b" валит контейнер с JSONDecodeError. Поэтому
    # принимаем строку, а разбиение на список делаем в свойстве.
    CORS_ORIGINS: str = Field(default=",".join(_DEFAULT_CORS_ORIGINS))

    # Регулярка для origin: по умолчанию разрешаем любой localhost/127.0.0.1
    # с любым портом — удобно при работе Vite (5173/5174/5175/…).
    CORS_ORIGIN_REGEX: str = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _normalize_cors(cls, v: object) -> str:
        """Приводит любые допустимые формы к строке-CSV.

        Допустимые формы задания CORS_ORIGINS:
          * пустая строка / None → пусто (никаких origin);
          * "*" → разрешить все;
          * "https://a,https://b" → список через запятую;
          * список Python (например, из defaults) → склеиваем через запятую.
        """
        if v is None:
            return ""
        if isinstance(v, (list, tuple)):
            return ",".join(str(x).strip() for x in v if str(x).strip())
        return str(v).strip()

    @property
    def cors_origins_list(self) -> list[str]:
        """CORS_ORIGINS в виде готового списка (для CORSMiddleware)."""
        v = self.CORS_ORIGINS.strip()
        if not v:
            return []
        if v == "*":
            return ["*"]
        return [item.strip() for item in v.split(",") if item.strip()]

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
