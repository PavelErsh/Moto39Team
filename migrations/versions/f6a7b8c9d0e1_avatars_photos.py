"""users.avatar_url, motorcycles.photo_url

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-07-25 11:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column("avatar_url", sa.String(length=500), nullable=True)
        )
    with op.batch_alter_table("motorcycles") as batch:
        batch.add_column(
            sa.Column("photo_url", sa.String(length=500), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("motorcycles") as batch:
        batch.drop_column("photo_url")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("avatar_url")
