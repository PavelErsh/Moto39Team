"""Добавляет emergency_status в модель User

Revision ID: e0f1a2b3c4d5
Revises: a8b9c0d1e2f3
Create Date: 2026-08-08 12:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "e0f1a2b3c4d5"
down_revision: Union[str, None] = "a8b9c0d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Используем ADD COLUMN IF NOT EXISTS чтобы миграция была
    # идемпотентной: если колонка уже создана (например, предыдущим
    # неудачным запуском), ошибки не будет. Данные не теряются.
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "emergency_status VARCHAR(16)"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "emergency_status_at TIMESTAMPTZ"
    )


def downgrade() -> None:
    op.drop_column("users", "emergency_status")
    op.drop_column("users", "emergency_status_at")
