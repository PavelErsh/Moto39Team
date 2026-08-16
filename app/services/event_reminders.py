"""Фоновая отправка push-напоминаний о мероприятиях и событиях."""
import asyncio
import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.crud.event import event_crud
from app.crud.ride import ride_crud
from app.db.session import AsyncSessionLocal
from app.models.push_delivery_log import PushDeliveryLog
from app.services.push import PushPayload, push_service

logger = logging.getLogger(__name__)

REMINDER_NOTIFICATION_TYPE = "event_day_before"
REMINDER_HOUR = 10
REMINDER_MINUTE = 0


@dataclass
class ReminderItem:
    entity_type: str
    entity_id: int
    event_date: date
    title: str
    location: str
    url: str
    push_title: str
    push_body: str


async def _was_sent(
    entity_type: str,
    entity_id: int,
    target_date: date,
) -> bool:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PushDeliveryLog.id).where(
                PushDeliveryLog.notification_type == REMINDER_NOTIFICATION_TYPE,
                PushDeliveryLog.entity_type == entity_type,
                PushDeliveryLog.entity_id == entity_id,
                PushDeliveryLog.target_date == target_date,
            )
        )
        return result.scalar_one_or_none() is not None


async def _mark_sent(
    entity_type: str,
    entity_id: int,
    target_date: date,
) -> bool:
    async with AsyncSessionLocal() as db:
        log_entry = PushDeliveryLog(
            notification_type=REMINDER_NOTIFICATION_TYPE,
            entity_type=entity_type,
            entity_id=entity_id,
            target_date=target_date,
        )
        db.add(log_entry)
        try:
            await db.commit()
            return True
        except IntegrityError:
            await db.rollback()
            return False


def _build_payload(item: ReminderItem) -> PushPayload:
    return PushPayload(
        title=item.push_title,
        body=item.push_body,
        tag=f"{REMINDER_NOTIFICATION_TYPE}-{item.entity_type}-{item.entity_id}",
        url=item.url,
        data={
            "type": "event_reminder",
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "event_date": item.event_date.isoformat(),
        },
    )


async def collect_tomorrow_items() -> list[ReminderItem]:
    tomorrow = date.today() + timedelta(days=1)
    async with AsyncSessionLocal() as db:
        events = await event_crud.list_all(db)
        rides = await ride_crud.list_all(db)

    items: list[ReminderItem] = []
    for event in events:
        if event.event_date == tomorrow:
            items.append(
                ReminderItem(
                    entity_type="event",
                    entity_id=event.id,
                    event_date=event.event_date,
                    title=event.title,
                    location=event.location,
                    push_body=(
                        f"Уже завтра состоится мероприятие «{event.title}». "
                        f"Место встречи: {event.location}. Загляните в календарь, "
                        "чтобы не пропустить детали."
                    ),
                    url=f"/calendar/{event.id}",
                    push_title="📅 Напоминание о мероприятии",
                )
            )
    for ride in rides:
        if ride.event_date == tomorrow:
            items.append(
                ReminderItem(
                    entity_type="ride",
                    entity_id=ride.id,
                    event_date=ride.event_date,
                    title=ride.title,
                    location=ride.location,
                    url=f"/rides/{ride.id}",
                    push_title="🏍️ Завтра мотособытие",
                    push_body=(
                        f"Завтра стартует событие «{ride.title}». "
                        f"Локация: {ride.location}. Самое время подготовиться "
                        "к выезду и открыть карточку события."
                    ),
                )
            )
    return items


def _seconds_until_next_run(now: datetime | None = None) -> float:
    current = now or datetime.now()
    today_run = datetime.combine(
        current.date(),
        time(hour=REMINDER_HOUR, minute=REMINDER_MINUTE),
    )
    next_run = today_run if current < today_run else today_run + timedelta(days=1)
    return max((next_run - current).total_seconds(), 0)


async def send_due_event_reminders() -> None:
    if not push_service.enabled:
        logger.debug("Event reminders skipped: push disabled")
        return

    items = await collect_tomorrow_items()
    for item in items:
        if await _was_sent(item.entity_type, item.entity_id, item.event_date):
            continue
        marked = await _mark_sent(item.entity_type, item.entity_id, item.event_date)
        if not marked:
            continue
        try:
            await push_service.broadcast(_build_payload(item))
        except Exception:
            logger.exception(
                "Failed to broadcast reminder for %s:%s",
                item.entity_type,
                item.entity_id,
            )


async def reminders_loop() -> None:
    """Ежедневно отправляет напоминания о событиях ровно в 10:00."""
    while True:
        sleep_for = _seconds_until_next_run()
        if sleep_for > 0:
            await asyncio.sleep(sleep_for)
        try:
            await send_due_event_reminders()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Event reminders loop iteration failed")
        await asyncio.sleep(60)
