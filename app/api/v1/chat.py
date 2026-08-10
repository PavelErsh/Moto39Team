"""WebSocket + REST API для чата."""
import json
import logging
import re
import time

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.crud import chat as chat_crud
from app.models.chat import ChatMember, ChatRoom
from app.schemas.chat import (
    ChatMemberRead,
    ChatRoomCreate,
    ChatRoomDetail,
    ChatRoomRead,
    MemberAddRemove,
    MessageCreate,
    MessageRead,
    UnreadCounts,
    WsIncoming,
    WsOutgoing,
)
from app.services.ws_manager import (
    connect_room,
    disconnect_room,
    notify_user,
    publish_to_room,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# ── Состояние для rate limiting ──────────────────────────────────

_user_last_message: dict[int, float] = {}
_user_burst_times: dict[int, list[float]] = {}

# ── Ограничения для сообщений ────────────────────────────────────

MAX_MESSAGE_LENGTH = 5000  # максимальная длина текста сообщения
RATE_LIMIT_WINDOW = 1.0     # минимальный интервал между сообщениями (сек)
RATE_LIMIT_MAX = 5           # максимум пакетных сообщений за короткий burst
RATE_BURST_WINDOW = 5.0      # окно для подсчёта burst-сообщений

# ── Вспомогательные функции ─────────────────────────────────────

def _sanitize_content(content: str | None) -> str | None:
    """Очистка текста сообщения: удаление управляющих символов."""
    if content is None:
        return None
    # Убираем нулевые байты и control chars (кроме \n, \r, \t)
    sanitized = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', content)
    return sanitized[:MAX_MESSAGE_LENGTH]


# ── Вспомогательные функции ─────────────────────────────────────

def _room_to_read(room: ChatRoom, user_id: int, unread_counts: dict[int, int] | None = None) -> ChatRoomRead:
    """Преобразовать ORM-комнату в схему для списка."""
    last_msg = None
    if room.messages:
        m = room.messages[0]  # самая новая (LIMIT 1, desc)
        last_msg = _message_to_read(m)

    unread = unread_counts.get(room.id, 0) if unread_counts else 0

    return ChatRoomRead(
        id=room.id,
        name=room.name,
        room_type=room.room_type,
        created_by=room.created_by,
        created_at=room.created_at,
        updated_at=room.updated_at,
        last_message=last_msg,
        unread_count=unread,
        member_count=len(room.members),
        dm_partner_name=_dm_partner_name(room, user_id),
    )


def _dm_partner_name(room: ChatRoom, current_user_id: int) -> str | None:
    """Для DM-комнаты вернуть имя собеседника."""
    if room.room_type != "dm":
        return None
    for member in room.members:
        if member.user_id != current_user_id:
            return member.user.username if member.user else None
    return None


def _message_to_read(msg) -> MessageRead:
    """Преобразовать ORM-сообщение в схему."""
    sender = getattr(msg, "sender", None)
    return MessageRead(
        id=msg.id,
        room_id=msg.room_id,
        sender_id=msg.sender_id,
        content=msg.content,
        message_type=msg.message_type,
        image_url=msg.image_url,
        is_deleted=msg.is_deleted,
        created_at=msg.created_at,
        updated_at=msg.updated_at,
        sender_username=sender.username if sender else None,
        sender_avatar_url=sender.avatar_url if sender else None,
        sender_sponsor_badge=sender.sponsor_badge if sender else None,
    )


def _member_to_read(member: ChatMember) -> ChatMemberRead:
    """Преобразовать ORM-участника в схему."""
    user = member.user
    return ChatMemberRead(
        id=member.id,
        user_id=member.user_id,
        role=member.role,
        joined_at=member.joined_at,
        username=user.username if user else None,
        avatar_url=user.avatar_url if user else None,
        sponsor_badge=user.sponsor_badge if user else None,
    )


# ── REST: Комнаты ───────────────────────────────────────────────

@router.get("/rooms", response_model=list[ChatRoomRead])
async def list_rooms(
    db: DbSession,
    current_user: CurrentUser,
) -> list[ChatRoomRead]:
    """Список всех комнат пользователя."""
    rooms = await chat_crud.get_user_rooms(db, current_user.id)
    unread_counts = await chat_crud.get_unread_counts(db, current_user.id)
    return [_room_to_read(r, current_user.id, unread_counts) for r in rooms]


@router.post("/rooms", response_model=ChatRoomDetail, status_code=201)
async def create_room(
    data: ChatRoomCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> ChatRoomDetail:
    """Создать новую комнату.

    Групповые беседы (room_type="group") — только для админов.
    DM (room_type="dm") — доступны всем, но ограничены ровно двумя участниками.
    """
    # Только админ может создавать групповые беседы
    if data.room_type != "dm" and not current_user.is_superuser:
        raise HTTPException(
            status_code=403,
            detail="Только администратор может создавать групповые беседы",
        )
    # DM ограничен 2 участниками (создатель + один собеседник)
    if data.room_type == "dm":
        if len(data.member_ids) != 1:
            raise HTTPException(
                status_code=400,
                detail="Личный чат должен иметь ровно одного собеседника",
            )
        # Проверить, нет ли уже DM между этими двумя пользователями
        existing = await chat_crud.find_dm_room(
            db, current_user.id, data.member_ids[0]
        )
        if existing:
            # Возвращаем существующий DM вместо создания нового
            room = await chat_crud.get_room(db, existing.id)
            assert room is not None
            return ChatRoomDetail(
                id=room.id,
                name=room.name,
                room_type=room.room_type,
                created_by=room.created_by,
                created_at=room.created_at,
                updated_at=room.updated_at,
                last_message=None,
                unread_count=0,
                member_count=len(room.members),
                members=[_member_to_read(m) for m in room.members],
            )

    room = await chat_crud.create_room(db, data, current_user.id)
    # Перечитываем для получения members
    room = await chat_crud.get_room(db, room.id)
    assert room is not None
    return ChatRoomDetail(
        id=room.id,
        name=room.name,
        room_type=room.room_type,
        created_by=room.created_by,
        created_at=room.created_at,
        updated_at=room.updated_at,
        last_message=None,
        unread_count=0,
        member_count=len(room.members),
        members=[_member_to_read(m) for m in room.members],
    )


@router.get("/rooms/{room_id}", response_model=ChatRoomDetail)
async def get_room_detail(
    room_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> ChatRoomDetail:
    """Детальная информация о комнате."""
    room = await chat_crud.get_room(db, room_id)
    if not room:
        raise HTTPException(404, "Комната не найдена")
    if not await chat_crud.is_member(db, room_id, current_user.id):
        raise HTTPException(403, "Вы не участник этой комнаты")
    return ChatRoomDetail(
        id=room.id,
        name=room.name,
        room_type=room.room_type,
        created_by=room.created_by,
        created_at=room.created_at,
        updated_at=room.updated_at,
        last_message=None,
        unread_count=0,
        member_count=len(room.members),
        members=[_member_to_read(m) for m in room.members],
    )


# ── REST: Участники ─────────────────────────────────────────────

@router.post("/rooms/{room_id}/members")
async def add_members_endpoint(
    room_id: int,
    data: MemberAddRemove,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Добавить участников в комнату (только админ)."""
    room = await chat_crud.get_room(db, room_id)
    if not room:
        raise HTTPException(404, "Комната не найдена")
    member = next(
        (m for m in room.members if m.user_id == current_user.id), None
    )
    if not member or member.role != "admin":
        raise HTTPException(403, "Только админ может добавлять участников")
    await chat_crud.add_members(db, room_id, data.user_ids)
    return {"ok": True, "added": len(data.user_ids)}


@router.delete("/rooms/{room_id}/members")
async def remove_members_endpoint(
    room_id: int,
    data: MemberAddRemove,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    """Удалить участников из комнаты (только админ)."""
    room = await chat_crud.get_room(db, room_id)
    if not room:
        raise HTTPException(404, "Комната не найдена")
    member = next(
        (m for m in room.members if m.user_id == current_user.id), None
    )
    if not member or member.role != "admin":
        raise HTTPException(403, "Только админ может удалять участников")
    await chat_crud.remove_members(db, room_id, data.user_ids)
    return {"ok": True, "removed": len(data.user_ids)}


# ── REST: Сообщения ─────────────────────────────────────────────

@router.get("/rooms/{room_id}/messages", response_model=list[MessageRead])
async def list_messages(
    room_id: int,
    db: DbSession,
    current_user: CurrentUser,
    before_id: int | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
) -> list[MessageRead]:
    """Получить сообщения комнаты (пагинация назад)."""
    if not await chat_crud.is_member(db, room_id, current_user.id):
        raise HTTPException(403, "Вы не участник этой комнаты")
    messages = await chat_crud.get_room_messages(
        db, room_id, before_id=before_id, limit=limit
    )
    # get_room_messages возвращает DESC, переворачиваем для хронологического порядка
    return [_message_to_read(m) for m in reversed(messages)]


@router.post("/rooms/{room_id}/read", response_model=dict)
async def mark_read_endpoint(
    room_id: int,
    db: DbSession,
    current_user: CurrentUser,
    message_id: int = Query(..., ge=1),
) -> dict:
    """Отметить сообщения прочитанными до message_id."""
    if not await chat_crud.is_member(db, room_id, current_user.id):
        raise HTTPException(403, "Вы не участник этой комнаты")
    await chat_crud.mark_read(db, room_id, current_user.id, message_id)
    return {"ok": True}


@router.get("/unread", response_model=UnreadCounts)
async def get_unread(
    db: DbSession,
    current_user: CurrentUser,
) -> UnreadCounts:
    """Получить счётчики непрочитанных сообщений."""
    counts = await chat_crud.get_unread_counts(db, current_user.id)
    return UnreadCounts(
        total=sum(counts.values()),
        rooms=counts,
    )


# ── WebSocket ───────────────────────────────────────────────────

@router.websocket("/ws")
async def chat_websocket(websocket: WebSocket):
    """
    Основной WebSocket эндпоинт чата.

    Принимает JSON-сообщения от клиента:
      {"type": "join", "room_id": 1}
      {"type": "leave", "room_id": 1}
      {"type": "message", "room_id": 1, "content": "Привет!"}
      {"type": "typing", "room_id": 1}
      {"type": "read", "room_id": 1, "message_id": 42}
    """
    from app.db.session import AsyncSessionLocal

    await websocket.accept()
    session: AsyncSession = AsyncSessionLocal()
    user_id: int | None = None
    joined_rooms: set[int] = set()

    try:
        # Ждём первый фрейм — токен аутентификации
        raw = await websocket.receive_text()
        token_data = json.loads(raw)
        token = token_data.get("token", "")

        # Валидируем токен
        try:
            user = None
            # Простая проверка токена
            from app.core.security import decode_token
            payload = decode_token(token)
            if payload.get("type") != "access":
                raise ValueError("Invalid token type")
            uid_raw = payload.get("sub")
            if not uid_raw:
                raise ValueError("No sub")
            uid = int(uid_raw)
            from app.crud.user import user_crud
            user = await user_crud.get(session, uid)
            if not user:
                raise ValueError("User not found")
            user_id = user.id
        except Exception as e:
            logger.warning("WebSocket auth failed: %s", e)
            await websocket.send_json({"type": "error", "error": "Unauthorized"})
            await websocket.close(code=4001)
            return

        # Подтверждаем авторизацию
        await websocket.send_json({"type": "connected", "user_id": user_id})

        # Основной цикл
        while True:
            raw = await websocket.receive_text()
            try:
                msg = WsIncoming.model_validate_json(raw)
            except Exception:
                await websocket.send_json(
                    {"type": "error", "error": "Invalid message format"}
                )
                continue

            if msg.type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg.type == "join":
                if not msg.room_id:
                    continue
                if not await chat_crud.is_member(session, msg.room_id, user_id):
                    await websocket.send_json(
                        {"type": "error", "error": "Вы не участник комнаты"}
                    )
                    continue
                await connect_room(msg.room_id, user_id, websocket)
                joined_rooms.add(msg.room_id)
                logger.info("User %d joined room %d", user_id, msg.room_id)

            elif msg.type == "leave":
                if msg.room_id:
                    await disconnect_room(msg.room_id, websocket)
                    joined_rooms.discard(msg.room_id)

            elif msg.type == "message":
                if not msg.room_id:
                    continue
                if not await chat_crud.is_member(session, msg.room_id, user_id):
                    await websocket.send_json(
                        {"type": "error", "error": "Вы не участник комнаты"}
                    )
                    continue

                # Rate limiting: проверка по пользователю
                now = time.monotonic()
                last_time = _user_last_message.get(user_id, 0)
                if now - last_time < RATE_LIMIT_WINDOW:
                    await websocket.send_json(
                        {"type": "error", "error": "Слишком быстро. Подождите секунду."}
                    )
                    continue

                # Burst check
                burst_times = _user_burst_times.get(user_id, [])
                burst_times = [t for t in burst_times if now - t < RATE_BURST_WINDOW]
                if len(burst_times) >= RATE_LIMIT_MAX:
                    await websocket.send_json(
                        {"type": "error", "error": "Слишком много сообщений. Подождите."}
                    )
                    continue
                burst_times.append(now)
                _user_burst_times[user_id] = burst_times
                _user_last_message[user_id] = now

                # Sanitize content
                sanitized_content = _sanitize_content(msg.content)
                if sanitized_content is None or len(sanitized_content.strip()) == 0:
                    await websocket.send_json(
                        {"type": "error", "error": "Сообщение не может быть пустым"}
                    )
                    continue

                # Сохраняем в БД
                msg_data = MessageCreate(
                    content=sanitized_content,
                    message_type=msg.message_type or "text",
                    image_url=msg.image_url,
                )
                saved = await chat_crud.save_message(
                    session, msg.room_id, user_id, msg_data
                )
                msg_read = _message_to_read(saved)

                # Рассылаем всем в комнате (через Redis или локально)
                outgoing = WsOutgoing(
                    type="message",
                    room_id=msg.room_id,
                    message=msg_read,
                )
                await publish_to_room(
                    msg.room_id,
                    outgoing.model_dump(mode="json"),
                )

                # Отправляем уведомления всем участникам комнаты (кроме отправителя)
                room = await chat_crud.get_room(session, msg.room_id)
                if room:
                    from app.crud.push import get_subscriptions_for_user
                    from app.services.push import PushPayload, push_service

                    for member in room.members:
                        if member.user_id != user_id:
                            # WebSocket-уведомление (если онлайн)
                            await notify_user(
                                member.user_id,
                                {
                                    "type": "new_message",
                                    "room_id": msg.room_id,
                                    "room_name": room.name or "Чат",
                                    "sender_username": user.username,
                                    "preview": (msg.content or "")[:100],
                                },
                            )

                            # Push-уведомление отправляем всем подписанным устройствам.
                            # Причина: наличие активного WebSocket ещё не означает,
                            # что пользователь смотрит на экран. На заблокированном
                            # телефоне / в фоне JS может быть уснувшим, а системный
                            # push всё равно нужен.
                            try:
                                subs = await get_subscriptions_for_user(
                                    session, member.user_id
                                )
                                for sub in subs:
                                    await push_service.send(
                                        endpoint=sub.endpoint,
                                        p256dh=sub.p256dh,
                                        auth=sub.auth,
                                        payload=PushPayload(
                                            title=f"💬 {user.username}",
                                            body=(msg.content or "")[:120],
                                            tag=f"chat-room-{msg.room_id}",
                                            url=f"/chat?room={msg.room_id}",
                                            data={
                                                "type": "new_message",
                                                "room_id": msg.room_id,
                                                "sender_id": user_id,
                                            },
                                        ),
                                    )
                            except Exception:
                                pass  # не блокируем отправку сообщения из-за ошибки push

            elif msg.type == "typing":
                if msg.room_id:
                    await publish_to_room(
                        msg.room_id,
                        {
                            "type": "typing",
                            "room_id": msg.room_id,
                            "user_id": user_id,
                            "username": user.username,
                        },
                    )

            elif msg.type == "read":
                if msg.room_id and msg.message_id:
                    await chat_crud.mark_read(
                        session, msg.room_id, user_id, msg.message_id
                    )
                    await publish_to_room(
                        msg.room_id,
                        {
                            "type": "read",
                            "room_id": msg.room_id,
                            "user_id": user_id,
                            "message_id": msg.message_id,
                        },
                    )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for user %d", user_id)
    except Exception:
        logger.exception("WebSocket error for user %d", user_id)
    finally:
        for rid in joined_rooms:
            await disconnect_room(rid, websocket)
        await session.close()
