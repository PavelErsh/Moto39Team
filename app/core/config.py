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

    # ---------------------------------------------------------------
    # Верификация e-mail при регистрации
    # ---------------------------------------------------------------
    # Требовать ли подтверждение email кодом из письма перед созданием
    # учётной записи. В dev-окружении можно отключить, чтобы не
    # настраивать SMTP.
    EMAIL_VERIFICATION_ENABLED: bool = True
    # Длина цифрового кода подтверждения.
    EMAIL_CODE_LENGTH: int = 6
    # Срок жизни кода в минутах.
    EMAIL_CODE_TTL_MINUTES: int = 15
    # Максимум неверных попыток ввода кода до инвалидации.
    EMAIL_CODE_MAX_ATTEMPTS: int = 5
    # Минимальный интервал между отправками кода одному email, сек.
    EMAIL_CODE_RESEND_INTERVAL_SECONDS: int = 60

    # SMTP-настройки (Mail.ru/Yandex/Gmail/SES и т.п.).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    # STARTTLS (обычно 587) или прямой TLS (465).
    SMTP_USE_TLS: bool = False
    SMTP_USE_STARTTLS: bool = True
    # From-адрес и отображаемое имя отправителя.
    SMTP_FROM_EMAIL: str = ""
    SMTP_FROM_NAME: str = "Moto39Team"
    # Если True — не отправляем письмо реально, а печатаем код в лог.
    # Удобно для локальной разработки без SMTP.
    EMAIL_CONSOLE_FALLBACK: bool = True

    # ---------------------------------------------------------------
    # Cloudflare Turnstile (капча)
    # ---------------------------------------------------------------
    # Включить проверку капчи на регистрации.
    TURNSTILE_ENABLED: bool = False
    # Site key (используется на фронте; здесь только для удобства
    # проверки/логирования).
    TURNSTILE_SITE_KEY: str = ""
    # Секретный ключ, которым бэкенд проверяет токен у Cloudflare.
    TURNSTILE_SECRET_KEY: str = ""
    # URL проверки токена.
    TURNSTILE_VERIFY_URL: str = (
        "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    )

    # ---------------------------------------------------------------
    # Redis (чат и Pub/Sub)
    # ---------------------------------------------------------------
    REDIS_URL: str = "redis://localhost:6379/0"

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
