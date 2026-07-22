"""events: cover_image_url, images

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-21 01:20:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch:
        batch.add_column(
            sa.Column(
                "cover_image_url", sa.String(length=500), nullable=True
            )
        )
        batch.add_column(
            sa.Column(
                "images",
                sa.JSON(),
                nullable=False,
                server_default="[]",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("events") as batch:
        batch.drop_column("images")
        batch.drop_column("cover_image_url")
