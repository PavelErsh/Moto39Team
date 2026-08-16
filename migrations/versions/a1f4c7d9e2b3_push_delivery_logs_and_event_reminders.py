"""push delivery logs for event reminders

Revision ID: a1f4c7d9e2b3
Revises: d92fb37bdee9
Create Date: 2026-08-16 23:15:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1f4c7d9e2b3"
down_revision: str | None = "d92fb37bdee9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "push_delivery_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("notification_type", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "notification_type",
            "entity_type",
            "entity_id",
            "target_date",
            name="uq_push_delivery_logs_notification_entity_target",
        ),
    )
    op.create_index(op.f("ix_push_delivery_logs_id"), "push_delivery_logs", ["id"], unique=False)
    op.create_index(
        op.f("ix_push_delivery_logs_notification_type"),
        "push_delivery_logs",
        ["notification_type"],
        unique=False,
    )
    op.create_index(op.f("ix_push_delivery_logs_entity_type"), "push_delivery_logs", ["entity_type"], unique=False)
    op.create_index(op.f("ix_push_delivery_logs_entity_id"), "push_delivery_logs", ["entity_id"], unique=False)
    op.create_index(op.f("ix_push_delivery_logs_target_date"), "push_delivery_logs", ["target_date"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_push_delivery_logs_target_date"), table_name="push_delivery_logs")
    op.drop_index(op.f("ix_push_delivery_logs_entity_id"), table_name="push_delivery_logs")
    op.drop_index(op.f("ix_push_delivery_logs_entity_type"), table_name="push_delivery_logs")
    op.drop_index(op.f("ix_push_delivery_logs_notification_type"), table_name="push_delivery_logs")
    op.drop_index(op.f("ix_push_delivery_logs_id"), table_name="push_delivery_logs")
    op.drop_table("push_delivery_logs")
