"""events: end_date (multi-day events)

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-07-28 20:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch:
        batch.add_column(sa.Column("end_date", sa.Date(), nullable=True))
        batch.create_index(
            "ix_events_end_date", ["end_date"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("events") as batch:
        batch.drop_index("ix_events_end_date")
        batch.drop_column("end_date")
