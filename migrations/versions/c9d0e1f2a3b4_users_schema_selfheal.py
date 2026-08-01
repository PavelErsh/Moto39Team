"""users: self-heal missing columns

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-08-01 00:10:00.000000

Мотивация
---------
На некоторых серверах таблица ``users`` была создана вручную (или очень
старой версией миграций) без части колонок, которые ORM ждёт сейчас:
``email``, ``avatar_url``, ``last_lat``, ``last_lng``, ``last_accuracy``,
``last_seen_at`` и т.п. Это приводит к падениям вида::

    UndefinedColumnError: column users.email does not exist

Обычные миграции здесь уже применены (alembic_version = head), поэтому
недостающие колонки не появятся. Эта миграция «самолечится»: для каждой
ожидаемой колонки выполняет ``ADD COLUMN IF NOT EXISTS`` (Postgres) или
проверку через ``batch_alter_table`` + inspector (SQLite/остальные).
Никаких данных не теряет.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Колонки, которые должны быть в таблице users на актуальной head-версии.
# Порядок важен только для читаемости — на схему не влияет.
_USER_COLUMNS: list[tuple[str, sa.types.TypeEngine, dict]] = [
    ("email", sa.String(length=255), {"nullable": True}),
    ("username", sa.String(length=64), {"nullable": True}),
    ("hashed_password", sa.String(length=255), {"nullable": True}),
    ("full_name", sa.String(length=255), {"nullable": True}),
    ("avatar_url", sa.String(length=500), {"nullable": True}),
    (
        "is_active",
        sa.Boolean(),
        {"nullable": False, "server_default": sa.text("true")},
    ),
    (
        "is_superuser",
        sa.Boolean(),
        {"nullable": False, "server_default": sa.text("false")},
    ),
    (
        "created_at",
        sa.DateTime(timezone=True),
        {"nullable": False, "server_default": sa.func.now()},
    ),
    (
        "updated_at",
        sa.DateTime(timezone=True),
        {"nullable": False, "server_default": sa.func.now()},
    ),
    ("last_lat", sa.Float(), {"nullable": True}),
    ("last_lng", sa.Float(), {"nullable": True}),
    ("last_accuracy", sa.Float(), {"nullable": True}),
    (
        "last_seen_at",
        sa.DateTime(timezone=True),
        {"nullable": True},
    ),
]


def _existing_columns(bind, table: str) -> set[str]:
    """Вернуть set имён существующих колонок таблицы."""
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()

    # Если таблицы users вообще нет — создадим её целиком (защитная логика,
    # маловероятная на проде, но полезная для чистых баз, где по какой-то
    # причине init-миграция не отработала).
    inspector = sa.inspect(bind)
    if "users" not in inspector.get_table_names():
        op.create_table(
            "users",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("username", sa.String(length=64), nullable=False),
            sa.Column(
                "hashed_password", sa.String(length=255), nullable=False
            ),
            sa.Column("full_name", sa.String(length=255), nullable=True),
            sa.Column("avatar_url", sa.String(length=500), nullable=True),
            sa.Column(
                "is_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
            sa.Column(
                "is_superuser",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("last_lat", sa.Float(), nullable=True),
            sa.Column("last_lng", sa.Float(), nullable=True),
            sa.Column("last_accuracy", sa.Float(), nullable=True),
            sa.Column(
                "last_seen_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_users_email", "users", ["email"], unique=True
        )
        op.create_index(
            "ix_users_id", "users", ["id"], unique=False
        )
        op.create_index(
            "ix_users_username", "users", ["username"], unique=True
        )
        return

    existing = _existing_columns(bind, "users")

    # Добавляем недостающие колонки. Все — nullable/со server_default,
    # чтобы не поломать существующие строки.
    for name, type_, kwargs in _USER_COLUMNS:
        if name in existing:
            continue
        op.add_column("users", sa.Column(name, type_, **kwargs))

    # Индексы для email/username (если их вдруг тоже нет).
    existing_indexes = {
        idx["name"] for idx in sa.inspect(bind).get_indexes("users")
    }
    if "ix_users_email" not in existing_indexes and "email" in {
        c["name"] for c in sa.inspect(bind).get_columns("users")
    }:
        try:
            op.create_index(
                "ix_users_email", "users", ["email"], unique=True
            )
        except Exception:  # noqa: BLE001
            # Индекс может уже существовать под другим именем — не критично.
            pass
    if "ix_users_username" not in existing_indexes and "username" in {
        c["name"] for c in sa.inspect(bind).get_columns("users")
    }:
        try:
            op.create_index(
                "ix_users_username", "users", ["username"], unique=True
            )
        except Exception:  # noqa: BLE001
            pass


def downgrade() -> None:
    # Down-миграция не удаляет колонки: в отличие от обычной миграции,
    # эта задача была «залечить» рассинхрон схемы. Автоматически
    # откатывать нечего.
    pass
