"""Pydantic-схемы для чата."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# ── Сообщение ──────────────────────────────────────────────────

class MessageRead(BaseModel):
    """Сообщение (ответ API)."""
    id: int
    room_id: int
    sender_id: int | None
    content: str | None
    message_type: str
    image_url: str | None
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    sender_username: str | None = None
    sender_avatar_url: str | None = None
    sender_sponsor_badge: str | None = None
    reply_to: "ReplyMessageRead | None" = None
    reactions: list["MessageReactionRead"] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class MessageCreate(BaseModel):
    """Тело запроса на отправку сообщения."""
    content: str | None = None
    message_type: str = "text"  # "text" | "image"
    image_url: str | None = None
    reply_to_message_id: int | None = None


class ReplyMessageRead(BaseModel):
    """Краткое представление сообщения, на которое дан ответ."""
    id: int
    sender_id: int | None
    sender_username: str | None = None
    content: str | None
    message_type: str
    image_url: str | None
    is_deleted: bool

    model_config = ConfigDict(from_attributes=True)


class MessageReactionRead(BaseModel):
    """Агрегированная реакция на сообщение."""
    emoji: str
    count: int
    reacted_by_me: bool = False


class MessageReactionToggle(BaseModel):
    """Поставить/снять реакцию на сообщение."""
    emoji: str = Field(min_length=1, max_length=16)


# ── Комната ────────────────────────────────────────────────────

class ChatRoomCreate(BaseModel):
    """Создание комнаты."""
    name: str | None = Field(default=None, max_length=255)
    room_type: str = "group"  # "group" | "dm"
    member_ids: list[int] = Field(default_factory=list, min_length=1)


class ChatRoomRead(BaseModel):
    """Комната (ответ API)."""
    id: int
    name: str | None
    room_type: str
    created_by: int | None
    created_at: datetime
    updated_at: datetime
    last_message: MessageRead | None = None
    unread_count: int = 0
    member_count: int = 0
    dm_partner_name: str | None = None
    notifications_enabled: bool = True

    model_config = ConfigDict(from_attributes=True)


class ChatRoomDetail(ChatRoomRead):
    """Детальная информация о комнате (с участниками)."""
    members: list["ChatMemberRead"] = []


class ChatMemberRead(BaseModel):
    """Участник комнаты."""
    id: int
    user_id: int
    role: str
    joined_at: datetime
    username: str | None = None
    avatar_url: str | None = None
    sponsor_badge: str | None = None

    model_config = ConfigDict(from_attributes=True)


# ── Участники ──────────────────────────────────────────────────

class MemberAddRemove(BaseModel):
    """Добавление / удаление участников комнаты."""
    user_ids: list[int] = Field(min_length=1)


# ── WebSocket-сообщения ────────────────────────────────────────

class WsIncoming(BaseModel):
    """Входящее WebSocket-сообщение от клиента."""
    type: str  # "join" | "leave" | "message" | "typing" | "read" | "reaction"
    room_id: int | None = None
    content: str | None = None
    message_type: str | None = None  # "text" | "image"
    image_url: str | None = None
    message_id: int | None = None  # для type="read"
    reply_to_message_id: int | None = None
    emoji: str | None = None


class WsOutgoing(BaseModel):
    """Исходящее WebSocket-сообщение клиенту."""
    type: str  # "message" | "typing" | "system" | "error" | "read" | "reaction"
    room_id: int | None = None
    message: MessageRead | None = None
    user_id: int | None = None
    username: str | None = None
    error: str | None = None
    message_id: int | None = None


# ── Уведомления ────────────────────────────────────────────────

class UnreadCounts(BaseModel):
    """Счётчики непрочитанных сообщений."""
    total: int = 0
    rooms: dict[int, int] = Field(default_factory=dict)


class ChatRoomNotificationsUpdate(BaseModel):
    """Настройка уведомлений для конкретной комнаты пользователя."""
    notifications_enabled: bool
