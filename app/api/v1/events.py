"""Роуты мотокалендаря (мероприятий).

Просмотр списка — доступен всем (включая неавторизованных).
Создание/редактирование/удаление — только для суперпользователей (админов).
"""
from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentSuperuser, DbSession
from app.crud.event import event_crud
from app.schemas.event import EventCreate, EventRead, EventUpdate

router = APIRouter()


@router.get(
    "",
    response_model=list[EventRead],
    summary="Список мероприятий (мотокалендарь)",
)
async def list_events(db: DbSession) -> list[EventRead]:
    items = await event_crud.list_all(db)
    return [EventRead.model_validate(e) for e in items]


@router.post(
    "",
    response_model=EventRead,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить мероприятие (только админ)",
)
async def create_event(
    data: EventCreate,
    admin: CurrentSuperuser,
    db: DbSession,
) -> EventRead:
    event = await event_crud.create(db, data, created_by=admin.id)
    return EventRead.model_validate(event)


@router.patch(
    "/{event_id}",
    response_model=EventRead,
    summary="Обновить мероприятие (только админ)",
)
async def update_event(
    event_id: int,
    data: EventUpdate,
    _: CurrentSuperuser,
    db: DbSession,
) -> EventRead:
    event = await event_crud.get(db, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Мероприятие не найдено",
        )
    event = await event_crud.update(db, event, data)
    return EventRead.model_validate(event)


@router.delete(
    "/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить мероприятие (только админ)",
)
async def delete_event(
    event_id: int,
    _: CurrentSuperuser,
    db: DbSession,
) -> None:
    event = await event_crud.get(db, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Мероприятие не найдено",
        )
    await event_crud.delete(db, event)
