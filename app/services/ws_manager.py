"""Менеджер WebSocket-соединений и Redis Pub/Sub.

Потокобезопасность:
- Все мутации глобальных структур защищены asyncio.Lock.
- Рассылка делает копию set перед итерацией, чтобы избежать
  «Set changed size during iteration» при удалении dead-соединений.
- Redis Pub/Sub не вызывает локальную рассылку повторно:
  отправитель получает сообщение только через локальный вызов
  notify_room, а Redis-сообщения фильтруются по _exclude_user.
"""
import asyncio
import json
import logging
from typing import Any

import redis.asyncio as redis

logger = logging.getLogger(__name__)

# ── Глобальные хранилища соединений ──────────────────────────────
#
# Все операции с этими структурами защищены _ws_lock.

rooms: dict[int, set[Any]] = {}        # room_id → set[WebSocket]
user_ws: dict[int, set[Any]] = {}      # user_id → set[WebSocket]
ws_to_user: dict[Any, int] = {}        # WebSocket → user_id

_ws_lock = asyncio.Lock()


async def connect_room(room_id: int, user_id: int, websocket: Any) -> None:
    """Подключить WebSocket к комнате (потокобезопасно)."""
    async with _ws_lock:
        rooms.setdefault(room_id, set()).add(websocket)
        user_ws.setdefault(user_id, set()).add(websocket)
        ws_to_user[websocket] = user_id


async def disconnect_room(room_id: int, websocket: Any) -> None:
    """Отключить WebSocket от комнаты (потокобезопасно)."""
    async with _ws_lock:
        if room_id in rooms:
            rooms[room_id].discard(websocket)
            if not rooms[room_id]:
                del rooms[room_id]
        user_id = ws_to_user.pop(websocket, None)
        if user_id and user_id in user_ws:
            user_ws[user_id].discard(websocket)
            if not user_ws[user_id]:
                del user_ws[user_id]


async def _copy_room_set(room_id: int) -> list[Any]:
    """Потокобезопасная копия списка WebSocket в комнате."""
    async with _ws_lock:
        if room_id not in rooms:
            return []
        return list(rooms[room_id])


async def _copy_user_set(user_id: int) -> list[Any]:
    """Потокобезопасная копия списка WebSocket пользователя."""
    async with _ws_lock:
        if user_id not in user_ws:
            return []
        return list(user_ws[user_id])


async def _remove_dead_from_room(room_id: int, dead: list[Any]) -> None:
    """Удалить отвалившиеся WebSocket из комнаты (потокобезопасно)."""
    if not dead:
        return
    async with _ws_lock:
        if room_id in rooms:
            for d in dead:
                rooms[room_id].discard(d)
            if not rooms[room_id]:
                del rooms[room_id]


async def _remove_dead_from_user(user_id: int, dead: list[Any]) -> None:
    """Удалить отвалившиеся WebSocket из списка пользователя."""
    if not dead:
        return
    async with _ws_lock:
        if user_id in user_ws:
            for d in dead:
                user_ws[user_id].discard(d)
            if not user_ws[user_id]:
                del user_ws[user_id]


async def notify_room(room_id: int, data: dict, *, exclude: Any = None) -> None:
    """Разослать сообщение всем участникам комнаты (потокобезопасно).

    Делает копию списка ws перед итерацией. Рассылает параллельно
    (asyncio.gather), чтобы один медленный клиент не тормозил всех.
    """
    ws_list = await _copy_room_set(room_id)
    if not ws_list:
        return

    payload = json.dumps(data, ensure_ascii=False, default=str)

    async def _send_one(ws: Any) -> bool:
        """Отправить одному клиенту. Возвращает True если отправка не удалась."""
        if ws is exclude:
            return True  # пропускаем (не dead, просто исключён)
        try:
            await ws.send_text(payload)
            return True
        except Exception:
            return False

    results = await asyncio.gather(*[_send_one(ws) for ws in ws_list], return_exceptions=True)

    # Собираем dead-соединения (те, что вернули False или исключение)
    dead: list[Any] = []
    for ws, ok in zip(ws_list, results):
        if ok is True or (isinstance(ok, BaseException) and not isinstance(ok, Exception)):
            # Успешно отправили, или это не Exception (не наша проблема)
            continue
        dead.append(ws)

    await _remove_dead_from_room(room_id, dead)
    for d in dead:
        async with _ws_lock:
            ws_to_user.pop(d, None)


async def notify_user(user_id: int, data: dict) -> None:
    """Отправить личное уведомление пользователю (все его соединения).

    Потокобезопасная версия с копированием списка перед итерацией.
    """
    ws_list = await _copy_user_set(user_id)
    if not ws_list:
        return

    payload = json.dumps(data, ensure_ascii=False, default=str)
    dead: list[Any] = []

    for ws in ws_list:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)

    await _remove_dead_from_user(user_id, dead)
    for d in dead:
        async with _ws_lock:
            ws_to_user.pop(d, None)


# ── Redis Pub/Sub (для горизонтального масштабирования) ──────────

_redis_pub: redis.Redis | None = None
_redis_sub: redis.Redis | None = None
_redis_listener_task: asyncio.Task | None = None


async def init_redis(redis_url: str = "redis://localhost:6379/0") -> None:
    """Инициализировать Redis Pub/Sub (pub + sub клиенты)."""
    global _redis_pub, _redis_sub, _redis_listener_task
    _redis_pub = redis.from_url(redis_url, decode_responses=True)
    _redis_sub = redis.from_url(redis_url, decode_responses=True)

    async def _listen() -> None:
        """Слушать Redis-каналы и пересылать локальным WebSocket."""
        assert _redis_sub is not None
        async with _redis_sub.pubsub() as pubsub:
            await pubsub.psubscribe("chat:*")
            logger.info("Redis Pub/Sub listener started")
            async for message in pubsub.listen():
                if message["type"] != "pmessage":
                    continue
                try:
                    data = json.loads(message["data"])
                    room_id = data.get("room_id")
                    exclude_user = data.get("_exclude_user")
                    if room_id:
                        # Потокобезопасно получаем ws отправителя для исключения
                        exclude_ws = None
                        if exclude_user:
                            async with _ws_lock:
                                if exclude_user in user_ws:
                                    # Берём первое соединение пользователя (обычно одно)
                                    for w in user_ws[exclude_user]:
                                        exclude_ws = w
                                        break
                        await notify_room(room_id, data, exclude=exclude_ws)
                except Exception:
                    logger.exception("Redis listener error")

    _redis_listener_task = asyncio.create_task(_listen())


async def close_redis() -> None:
    """Закрыть Redis-соединения."""
    global _redis_pub, _redis_sub, _redis_listener_task
    if _redis_listener_task:
        _redis_listener_task.cancel()
        _redis_listener_task = None
    if _redis_pub:
        await _redis_pub.aclose()
        _redis_pub = None
    if _redis_sub:
        await _redis_sub.aclose()
        _redis_sub = None


async def publish_to_room(room_id: int, data: dict) -> None:
    """Опубликовать сообщение в Redis-канал комнаты.

    Если Redis недоступен — автоматически фолбэчится на локальную рассылку.
    """
    if _redis_pub is None:
        await notify_room(room_id, data)
        return
    data["room_id"] = room_id
    try:
        await _redis_pub.publish(
            f"chat:{room_id}",
            json.dumps(data, ensure_ascii=False, default=str),
        )
    except Exception:
        # Redis упал/недоступен — фолбэк на локальную рассылку
        logger.warning("Redis publish failed, falling back to local notify")
        await notify_room(room_id, data)
