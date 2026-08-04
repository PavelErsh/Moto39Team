"""users: add sponsor_badge

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
Create Date: 2026-08-04 15:20:00.000000

Мотивация
---------
Админам нужно уметь выдавать пользователям «значок спонсора» (произвольный
эмодзи), который будет отображаться рядом с ником по всему интерфейсу.
Добавляем колонку ``users.sponsor_badge`` — короткая строка (до 16
символов, чтобы влезали составные эмодзи с модификаторами кожи и ZWJ).
Идемпотентно: если колонка уже есть — ничего не делаем.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "c0d1e2f3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(bind, table: str) -> set[str]:
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if "users" not in sa.inspect(bind).get_table_names():
        return
    if "sponsor_badge" in _existing_columns(bind, "users"):
        return
    op.add_column(
        "users",
        sa.Column("sponsor_badge", sa.String(length=16), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "sponsor_badge" not in _existing_columns(bind, "users"):
        return
    try:
        op.drop_column("users", "sponsor_badge")
    except Exception:  # noqa: BLE001
        # На старых версиях SQLite drop_column требует batch mode —
        # проглатываем ошибку, чтобы downgrade был best-effort.
        pass
