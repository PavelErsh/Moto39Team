"""rides (раздел «События» — отдельная таблица, не связанная с events/мотокалендарём)

Revision ID: a8b9c0d1e2f3
Revises: c9d0e1f2a3b4
Create Date: 2026-08-02 12:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8b9c0d1e2f3"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rides",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("organizer", sa.String(length=255), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("cover_image_url", sa.String(length=500), nullable=True),
        sa.Column(
            "images",
            sa.JSON(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_rides_id"), "rides", ["id"], unique=False)
    op.create_index(
        op.f("ix_rides_event_date"),
        "rides",
        ["event_date"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rides_end_date"),
        "rides",
        ["end_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_rides_end_date"), table_name="rides")
    op.drop_index(op.f("ix_rides_event_date"), table_name="rides")
    op.drop_index(op.f("ix_rides_id"), table_name="rides")
    op.drop_table("rides")
