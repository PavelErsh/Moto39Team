"""users: add emergency_status / emergency_status_at

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-08-02 21:00:00.000000

Мотивация
---------
ORM ждёт в таблице ``users`` колонки ``emergency_status`` и
``emergency_status_at`` (см. ``app/models/user.py``), но в существующих
базах после предыдущих self-heal-миграций их не оказалось. Из-за этого
любой запрос к users падает::

    UndefinedColumnError: column users.emergency_status does not exist

Эта миграция идемпотентно (``ADD COLUMN IF NOT EXISTS``) добавляет обе
колонки. Данные не теряются.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b9c0d1e2f3a4"
down_revision: Union[str, None] = "a8b9c0d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_NEW_COLUMNS: list[tuple[str, sa.types.TypeEngine, dict]] = [
    ("emergency_status", sa.String(length=16), {"nullable": True}),
    (
        "emergency_status_at",
        sa.DateTime(timezone=True),
        {"nullable": True},
    ),
]


def _existing_columns(bind, table: str) -> set[str]:
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if "users" not in sa.inspect(bind).get_table_names():
        # Никакой users нет — миграция init/selfheal должна была создать
        # его раньше; просто выходим, чтобы не падать.
        return

    existing = _existing_columns(bind, "users")
    for name, type_, kwargs in _NEW_COLUMNS:
        if name in existing:
            continue
        op.add_column("users", sa.Column(name, type_, **kwargs))


def downgrade() -> None:
    bind = op.get_bind()
    existing = _existing_columns(bind, "users")
    for name, _type, _kwargs in _NEW_COLUMNS:
        if name in existing:
            try:
                op.drop_column("users", name)
            except Exception:  # noqa: BLE001
                pass
