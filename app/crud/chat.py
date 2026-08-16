"""CRUD-операции для чата."""
from datetime import datetime, timedelta, timezone
import time

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.chat import ChatMember, ChatRoom, Message, MessageReaction
from app.models.user import User
from app.schemas.chat import ChatRoomCreate, MessageCreate
from app.api.v1._uploads import delete_uploaded_file_by_url


DEFAULT_BIKE_CHAT_NAME = "БАЙКЧАТ"
CHAT_IMAGE_TTL_DAYS = 14
_last_expired_chat_image_cleanup_monotonic = 0.0


# ── Комнаты ─────────────────────────────────────────────────────

async def create_room(
    db: AsyncSession, data: ChatRoomCreate, created_by: int
) -> ChatRoom:
    """Создать комнату (DM или групповую)."""
    room = ChatRoom(
        name=data.name,
        room_type=data.room_type,
        created_by=created_by,
    )
    db.add(room)
    await db.flush()

    # Создатель — всегда участник комнаты (роль зависит от типа)
    creator_role = "admin" if data.room_type != "dm" else "member"
    db.add(ChatMember(room_id=room.id, user_id=created_by, role=creator_role))
    # Остальные участники
    for uid in data.member_ids:
        if uid != created_by:
            db.add(ChatMember(room_id=room.id, user_id=uid, role="member"))

    await db.commit()
    await db.refresh(room)
    return room


async def find_dm_room(
    db: AsyncSession, user_a: int, user_b: int
) -> ChatRoom | None:
    """Найти существующий DM между двумя пользователями."""
    # Находим комнаты типа dm, где оба пользователя — участники
    sub_a = select(ChatMember.room_id).where(ChatMember.user_id == user_a).subquery()
    sub_b = select(ChatMember.room_id).where(ChatMember.user_id == user_b).subquery()
    result = await db.execute(
        select(ChatRoom)
        .where(
            ChatRoom.room_type == "dm",
            ChatRoom.id.in_(select(sub_a)),
            ChatRoom.id.in_(select(sub_b)),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_room(db: AsyncSession, room_id: int) -> ChatRoom | None:
    result = await db.execute(
        select(ChatRoom)
        .execution_options(populate_existing=True)
        .options(selectinload(ChatRoom.members).selectinload(ChatMember.user))
        .where(ChatRoom.id == room_id)
    )
    return result.scalar_one_or_none()


async def get_room_by_name(db: AsyncSession, name: str) -> ChatRoom | None:
    """Найти комнату по имени."""
    result = await db.execute(
        select(ChatRoom)
        .execution_options(populate_existing=True)
        .options(selectinload(ChatRoom.members).selectinload(ChatMember.user))
        .where(ChatRoom.name == name)
        .order_by(ChatRoom.id.asc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def ensure_default_bike_chat(
    db: AsyncSession,
    *,
    created_by: int | None = None,
) -> ChatRoom:
    """Вернуть комнату `БАЙКЧАТ`, создавая её при необходимости."""
    room = await get_room_by_name(db, DEFAULT_BIKE_CHAT_NAME)
    if room is not None:
        return room

    room = ChatRoom(
        name=DEFAULT_BIKE_CHAT_NAME,
        room_type="group",
        created_by=created_by,
    )
    db.add(room)
    await db.flush()

    if created_by is not None:
        db.add(ChatMember(room_id=room.id, user_id=created_by, role="admin"))

    await db.commit()
    refreshed = await get_room(db, room.id)
    assert refreshed is not None
    return refreshed


async def ensure_user_in_default_bike_chat(
    db: AsyncSession,
    user_id: int,
    *,
    room_created_by: int | None = None,
) -> ChatRoom:
    """Гарантировать, что пользователь состоит в `БАЙКЧАТ`."""
    room = await ensure_default_bike_chat(db, created_by=room_created_by)
    if not await is_member(db, room.id, user_id):
        await add_members(db, room.id, [user_id])
        refreshed = await get_room(db, room.id)
        assert refreshed is not None
        return refreshed
    return room


async def get_user_rooms(
    db: AsyncSession, user_id: int
) -> list[ChatRoom]:
    """Список комнат, в которых состоит пользователь."""
    sub = (
        select(ChatMember.room_id)
        .where(ChatMember.user_id == user_id)
        .subquery()
    )
    result = await db.execute(
        select(ChatRoom)
        .execution_options(populate_existing=True)
        .options(
            selectinload(ChatRoom.members).selectinload(ChatMember.user),
            selectinload(ChatRoom.messages),
        )
        .where(ChatRoom.id.in_(select(sub)))
        .order_by(ChatRoom.updated_at.desc())
    )
    rooms = list(result.scalars().all())
    # Оставляем только последнее сообщение в каждой комнате
    for room in rooms:
        if room.messages:
            room.messages = [
                max(
                    (m for m in room.messages if not m.is_deleted),
                    key=lambda m: m.created_at,
                    default=None,
                )
            ]
            # Убираем None если был только удалённые
            room.messages = [m for m in room.messages if m is not None]
    return rooms


async def add_members(
    db: AsyncSession, room_id: int, user_ids: list[int]
) -> None:
    """Добавить участников в комнату."""
    existing = await db.execute(
        select(ChatMember.user_id).where(
            ChatMember.room_id == room_id,
            ChatMember.user_id.in_(user_ids),
        )
    )
    existing_ids = {row[0] for row in existing.all()}
    for uid in user_ids:
        if uid not in existing_ids:
            db.add(ChatMember(room_id=room_id, user_id=uid, role="member"))
    await db.commit()


async def remove_members(
    db: AsyncSession, room_id: int, user_ids: list[int]
) -> None:
    """Удалить участников из комнаты."""
    await db.execute(
        ChatMember.__table__.delete().where(
            ChatMember.room_id == room_id,
            ChatMember.user_id.in_(user_ids),
        )
    )
    await db.commit()


async def is_member(db: AsyncSession, room_id: int, user_id: int) -> bool:
    """Проверить, состоит ли пользователь в комнате."""
    result = await db.execute(
        select(ChatMember)
        .execution_options(populate_existing=True)
        .where(
            ChatMember.room_id == room_id,
            ChatMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none() is not None


async def get_member(
    db: AsyncSession, room_id: int, user_id: int
) -> ChatMember | None:
    """Получить запись участника комнаты для пользователя."""
    result = await db.execute(
        select(ChatMember).where(
            ChatMember.room_id == room_id,
            ChatMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def set_notifications_enabled(
    db: AsyncSession, room_id: int, user_id: int, enabled: bool
) -> ChatMember | None:
    """Включить/выключить уведомления пользователя для комнаты."""
    await db.execute(
        update(ChatMember)
        .where(
            ChatMember.room_id == room_id,
            ChatMember.user_id == user_id,
        )
        .values(notifications_enabled=enabled)
    )
    await db.commit()
    return await get_member(db, room_id, user_id)


# ── Сообщения ───────────────────────────────────────────────────

async def save_message(
    db: AsyncSession,
    room_id: int,
    sender_id: int,
    data: MessageCreate,
) -> Message:
    """Сохранить сообщение в БД (потокобезопасно).

    Использует advisory-блокировку на уровне PostgreSQL/SQLite,
    чтобы два параллельных сообщения не устроили гонку при
    обновлении updated_at комнаты.

    Для PostgreSQL используется pg_advisory_xact_lock с ID=room_id,
    чтобы разные комнаты не конкурировали за одну блокировку.
    Для SQLite advisory-локи не поддерживаются, но конкурентность
    ограничена одним writer-ом, так что на практике проблем нет.
    """
    from sqlalchemy import text as sa_text

    # PostgreSQL: pg_advisory_xact_lock на уровне комнаты.
    # SQLite: advisory-локи не поддерживаются, пропускаем.
    try:
        await db.execute(sa_text(f"SELECT pg_advisory_xact_lock({room_id})"))
    except Exception:
        pass  # SQLite или другой диалект — игнорируем

    msg = Message(
        room_id=room_id,
        sender_id=sender_id,
        reply_to_message_id=data.reply_to_message_id,
        content=data.content,
        message_type=data.message_type,
        image_url=data.image_url,
    )
    db.add(msg)
    # Обновить updated_at комнаты
    await db.execute(
        update(ChatRoom)
        .where(ChatRoom.id == room_id)
        .values(updated_at=datetime.now(timezone.utc))
    )
    await db.commit()
    await db.refresh(msg)

    # Подгружаем отправителя
    sender_result = await db.execute(
        select(User).where(User.id == sender_id)
    )
    sender = sender_result.scalar_one_or_none()
    if sender:
        msg.sender = sender

    if msg.reply_to_message_id is not None:
        reply_result = await db.execute(
            select(Message)
            .options(selectinload(Message.sender))
            .where(
                Message.id == msg.reply_to_message_id,
                Message.room_id == room_id,
            )
        )
        msg.reply_to = reply_result.scalar_one_or_none()

    return msg


async def purge_expired_chat_images(
    db: AsyncSession,
    *,
    force: bool = False,
    min_interval_seconds: float = 3600,
) -> int:
    """Удалить chat image-сообщения и файлы старше TTL.

    Сообщения не удаляем физически из БД: помечаем как удалённые и очищаем
    content/image_url, чтобы не ломать ссылки на reply/reactions/history.
    """
    global _last_expired_chat_image_cleanup_monotonic

    now_mono = time.monotonic()
    if not force and now_mono - _last_expired_chat_image_cleanup_monotonic < min_interval_seconds:
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=CHAT_IMAGE_TTL_DAYS)
    result = await db.execute(
        select(Message).where(
            Message.message_type == "image",
            Message.image_url.is_not(None),
            Message.created_at < cutoff,
            Message.is_deleted.is_(False),
        )
    )
    expired = list(result.scalars().all())
    if not expired:
        _last_expired_chat_image_cleanup_monotonic = now_mono
        return 0

    affected_room_ids: set[int] = set()
    for message in expired:
        delete_uploaded_file_by_url(message.image_url)
        message.image_url = None
        message.content = None
        message.is_deleted = True
        affected_room_ids.add(message.room_id)

    if affected_room_ids:
        await db.execute(
            update(ChatRoom)
            .where(ChatRoom.id.in_(affected_room_ids))
            .values(updated_at=datetime.now(timezone.utc))
        )

    await db.commit()
    _last_expired_chat_image_cleanup_monotonic = now_mono
    return len(expired)


async def get_room_messages(
    db: AsyncSession,
    room_id: int,
    *,
    before_id: int | None = None,
    limit: int = 50,
) -> list[Message]:
    """Получить сообщения комнаты (пагинация назад)."""
    stmt = (
        select(Message)
        .options(
            selectinload(Message.sender),
            selectinload(Message.reply_to).selectinload(Message.sender),
            selectinload(Message.reactions),
        )
        .where(Message.room_id == room_id)
        .order_by(Message.created_at.desc())
    )
    if before_id:
        # Получаем created_at сообщения-"курсора"
        cursor_result = await db.execute(
            select(Message.created_at).where(Message.id == before_id)
        )
        cursor_ts = cursor_result.scalar_one_or_none()
        if cursor_ts:
            stmt = stmt.where(Message.created_at < cursor_ts)
    stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_room_message(
    db: AsyncSession, room_id: int, message_id: int
) -> Message | None:
    """Получить конкретное сообщение комнаты."""
    result = await db.execute(
        select(Message)
        .options(
            selectinload(Message.sender),
            selectinload(Message.reply_to).selectinload(Message.sender),
            selectinload(Message.reactions),
        )
        .where(
            Message.id == message_id,
            Message.room_id == room_id,
        )
    )
    return result.scalar_one_or_none()


async def delete_room_message(
    db: AsyncSession,
    room_id: int,
    message_id: int,
    user_id: int,
) -> Message | None:
    """Мягко удалить сообщение, если его удаляет автор."""
    message = await get_room_message(db, room_id, message_id)
    if not message:
        return None
    if message.sender_id != user_id:
        raise PermissionError("forbidden")
    if message.is_deleted:
        return message

    if message.image_url:
        delete_uploaded_file_by_url(message.image_url)

    message.content = None
    message.image_url = None
    message.is_deleted = True
    await db.commit()
    return await get_room_message(db, room_id, message_id)


async def toggle_message_reaction(
    db: AsyncSession, room_id: int, message_id: int, user_id: int, emoji: str
) -> Message | None:
    """Поставить/снять реакцию на сообщение и вернуть обновлённое сообщение."""
    message = await get_room_message(db, room_id, message_id)
    if not message:
        return None

    existing = await db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == user_id,
            MessageReaction.emoji == emoji,
        )
    )
    reaction = existing.scalar_one_or_none()

    if reaction:
        await db.execute(
            delete(MessageReaction).where(MessageReaction.id == reaction.id)
        )
    else:
        db.add(MessageReaction(message_id=message_id, user_id=user_id, emoji=emoji))

    await db.commit()
    return await get_room_message(db, room_id, message_id)


async def mark_read(
    db: AsyncSession, room_id: int, user_id: int, message_id: int
) -> None:
    """Отметить сообщения до message_id как прочитанные."""
    await db.execute(
        update(ChatMember)
        .where(
            ChatMember.room_id == room_id,
            ChatMember.user_id == user_id,
            or_(
                ChatMember.last_read_message_id < message_id,
                ChatMember.last_read_message_id.is_(None),
            ),
        )
        .values(last_read_message_id=message_id)
    )
    await db.commit()


async def get_unread_counts(
    db: AsyncSession, user_id: int
) -> dict[int, int]:
    """Подсчитать непрочитанные сообщения по комнатам."""
    # Для каждой комнаты пользователя: количество сообщений после last_read
    member_rows = await db.execute(
        select(ChatMember.room_id, ChatMember.last_read_message_id).where(
            ChatMember.user_id == user_id
        )
    )
    counts: dict[int, int] = {}
    for room_id, last_read in member_rows.all():
        stmt = select(func.count(Message.id)).where(
            Message.room_id == room_id,
            Message.sender_id != user_id,
        )
        if last_read is not None:
            stmt = stmt.where(Message.id > last_read)
        total = await db.execute(stmt)
        c = total.scalar() or 0
        if c > 0:
            counts[room_id] = c
    return counts
