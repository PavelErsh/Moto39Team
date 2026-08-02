"""Основной API-роутер v1."""
from fastapi import APIRouter

from app.api.v1 import (
    admin,
    auth,
    events,
    motorcycles,
    references,
    rides,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(
    motorcycles.router, prefix="/motorcycles", tags=["motorcycles"]
)
api_router.include_router(events.router, prefix="/events", tags=["events"])
api_router.include_router(rides.router, prefix="/rides", tags=["rides"])
api_router.include_router(
    references.router, prefix="/references", tags=["references"]
)
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
