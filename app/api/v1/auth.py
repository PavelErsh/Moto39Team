"""Роуты авторизации: регистрация, подтверждение email, логин, /me."""
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm


from app.api.deps import CurrentActiveUser, DbSession
from app.core.config import settings
from app.core.security import (
    JWTError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
)
from app.crud.email_verification import email_verification_crud
from app.crud.user import user_crud
from app.schemas.token import RefreshTokenRequest, Token
from app.schemas.user import (
    EmailVerificationRequest,
    RegisterStartResponse,
    ResendCodeRequest,
    UserCreate,
    UserRead,
)
from app.services.email import generate_code, send_verification_code
from app.services.turnstile import verify_turnstile_token

logger = logging.getLogger(__name__)

router = APIRouter()


def _client_ip(request: Request) -> str | None:

    """Извлечь IP клиента (учитывая X-Forwarded-For от nginx)."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None


def _as_utc(dt: datetime) -> datetime:
    """Некоторые БД возвращают naive datetime — приводим к UTC-aware."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@router.get(
    "/config",
    summary="Публичная конфигурация фронтенда (site key капчи и т.п.)",
)
async def public_config() -> dict[str, object]:
    """Возвращает публичные настройки для фронта.

    Здесь фронт узнаёт, нужно ли показывать капчу и с каким site-key,
    а также включена ли верификация email.
    """
    return {
        "turnstile_enabled": settings.TURNSTILE_ENABLED,
        "turnstile_site_key": settings.TURNSTILE_SITE_KEY,
        "email_verification_enabled": settings.EMAIL_VERIFICATION_ENABLED,
        "email_code_length": settings.EMAIL_CODE_LENGTH,
        "email_code_ttl_minutes": settings.EMAIL_CODE_TTL_MINUTES,
    }


@router.post(
    "/register",
    response_model=RegisterStartResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary=(
        "Начать регистрацию: проверить капчу и отправить код на email. "
        "Пользователь будет создан только после /auth/verify-email."
    ),
)
async def register(
    data: UserCreate, db: DbSession, request: Request
) -> RegisterStartResponse:
    # 1. Проверяем капчу Cloudflare Turnstile (если включена).
    if settings.TURNSTILE_ENABLED:
        ok = await verify_turnstile_token(
            data.turnstile_token, remote_ip=_client_ip(request)
        )
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Проверка капчи не пройдена",
            )

    # 2. Проверяем, что email/username ещё не заняты.
    if await user_crud.get_by_email(db, data.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пользователь с таким email уже существует",
        )
    if await user_crud.get_by_username(db, data.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пользователь с таким username уже существует",
        )

    # 3. Если верификация email выключена — создаём пользователя сразу.
    if not settings.EMAIL_VERIFICATION_ENABLED:
        await user_crud.create(db, data)
        return RegisterStartResponse(
            email=data.email,
            message="Регистрация выполнена (email verification disabled)",
            expires_in_minutes=0,
        )

    # 4. Rate-limit ресенда: если недавно уже отправляли код — не спамим.
    existing = await email_verification_crud.get_active_by_email(
        db, data.email
    )
    if existing is not None:
        last_sent = _as_utc(existing.last_sent_at)
        elapsed = (
            datetime.now(timezone.utc) - last_sent
        ).total_seconds()
        if elapsed < settings.EMAIL_CODE_RESEND_INTERVAL_SECONDS:
            wait = int(
                settings.EMAIL_CODE_RESEND_INTERVAL_SECONDS - elapsed
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Код уже отправлен. Повторите попытку через "
                    f"{wait} сек."
                ),
            )

    # 5. Сохраняем черновик регистрации + хеш пароля + одноразовый код.
    code = generate_code()
    await email_verification_crud.create(
        db,
        email=data.email,
        username=data.username,
        full_name=data.full_name,
        hashed_password=hash_password(data.password),
        code=code,
    )

    # 6. Отправляем письмо (в dev может печатать в лог). Если SMTP
    # не сконфигурирован и fallback выключен — не отдаём 500 наружу,
    # а откатываем черновик и возвращаем 503 с понятной причиной.
    try:
        await send_verification_code(data.email, code)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Не удалось отправить письмо с кодом на %s", data.email
        )
        await email_verification_crud.delete_by_email(db, data.email)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Не удалось отправить письмо с кодом подтверждения. "
                "Проверьте настройки почты на сервере или повторите "
                "попытку позже."
            ),
        ) from exc

    return RegisterStartResponse(
        email=data.email,
        expires_in_minutes=settings.EMAIL_CODE_TTL_MINUTES,
    )



@router.post(
    "/verify-email",
    response_model=Token,
    summary=(
        "Подтвердить email кодом из письма. При успехе создаёт "
        "пользователя и возвращает пару токенов (сразу вход)."
    ),
)
async def verify_email(
    data: EmailVerificationRequest, db: DbSession
) -> Token:
    if not settings.EMAIL_VERIFICATION_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Верификация email отключена в этой сборке",
        )

    draft = await email_verification_crud.get_active_by_email(db, data.email)
    if draft is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Код не запрашивался или уже использован",
        )

    # Срок действия.
    if _as_utc(draft.expires_at) < datetime.now(timezone.utc):
        await email_verification_crud.delete_by_email(db, data.email)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Срок действия кода истёк, запросите новый",
        )

    # Лимит попыток.
    if draft.attempts >= settings.EMAIL_CODE_MAX_ATTEMPTS:
        await email_verification_crud.delete_by_email(db, data.email)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Слишком много неверных попыток, запросите новый код",
        )

    if data.code.strip() != draft.code:
        await email_verification_crud.increment_attempts(db, draft)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный код подтверждения",
        )

    # На всякий случай ещё раз проверяем уникальность (мог кто-то занять).
    if await user_crud.get_by_email(db, draft.email):
        await email_verification_crud.delete_by_email(db, data.email)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пользователь с таким email уже существует",
        )
    if await user_crud.get_by_username(db, draft.username):
        await email_verification_crud.delete_by_email(db, data.email)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пользователь с таким username уже существует",
        )

    user = await user_crud.create_from_verified(
        db,
        email=draft.email,
        username=draft.username,
        full_name=draft.full_name,
        hashed_password=draft.hashed_password,
    )
    await email_verification_crud.delete_by_email(db, draft.email)

    return Token(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post(
    "/resend-code",
    response_model=RegisterStartResponse,
    summary="Повторно отправить код подтверждения на email",
)
async def resend_code(
    data: ResendCodeRequest, db: DbSession
) -> RegisterStartResponse:
    if not settings.EMAIL_VERIFICATION_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Верификация email отключена",
        )

    draft = await email_verification_crud.get_active_by_email(db, data.email)
    if draft is None:
        # Не раскрываем, зарегистрирован ли email; просто говорим,
        # что нужно снова начать регистрацию.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Активной заявки на регистрацию нет. "
                "Начните регистрацию заново."
            ),
        )

    # Rate-limit
    last_sent = _as_utc(draft.last_sent_at)
    elapsed = (datetime.now(timezone.utc) - last_sent).total_seconds()
    if elapsed < settings.EMAIL_CODE_RESEND_INTERVAL_SECONDS:
        wait = int(settings.EMAIL_CODE_RESEND_INTERVAL_SECONDS - elapsed)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Слишком часто. Повторите попытку через {wait} сек."
            ),
        )

    code = generate_code()
    await email_verification_crud.update_code(db, draft, code=code)
    await send_verification_code(data.email, code)

    return RegisterStartResponse(
        email=data.email,
        expires_in_minutes=settings.EMAIL_CODE_TTL_MINUTES,
    )


@router.post(
    "/login",
    response_model=Token,
    summary="Логин (OAuth2 password flow). Возвращает access и refresh токены.",
)
async def login(
    db: DbSession,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
) -> Token:
    user = await user_crud.authenticate(
        db, form_data.username, form_data.password
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверные учётные данные",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неактивный пользователь",
        )
    return Token(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post(
    "/refresh",
    response_model=Token,
    summary="Обновить пару токенов по refresh-токену",
)
async def refresh(payload: RefreshTokenRequest, db: DbSession) -> Token:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Невалидный refresh-токен",
    )
    try:
        data = decode_token(payload.refresh_token)
        if data.get("type") != "refresh":
            raise credentials_exception
        user_id = int(data["sub"])
    except (JWTError, KeyError, ValueError) as exc:
        raise credentials_exception from exc

    user = await user_crud.get(db, user_id)
    if user is None or not user.is_active:
        raise credentials_exception

    return Token(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.get(
    "/me",
    response_model=UserRead,
    summary="Текущий пользователь",
)
async def read_me(current_user: CurrentActiveUser) -> UserRead:
    return UserRead.model_validate(current_user)
