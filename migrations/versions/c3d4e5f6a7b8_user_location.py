"""user location fields

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-13 17:58:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("last_lat", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("last_lng", sa.Float(), nullable=True))
        batch_op.add_column(
            sa.Column("last_accuracy", sa.Float(), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "last_seen_at",
                sa.DateTime(timezone=True),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("last_seen_at")
        batch_op.drop_column("last_accuracy")
        batch_op.drop_column("last_lng")
        batch_op.drop_column("last_lat")
