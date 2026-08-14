"""motorcycles: photos gallery

Revision ID: fab1c2d3e4f5
Revises: fa0b1c2d3e4f
Create Date: 2026-08-14 02:05:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "fab1c2d3e4f5"
down_revision: Union[str, None] = "fa0b1c2d3e4f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("motorcycles") as batch:
        batch.add_column(
            sa.Column("photos", sa.JSON(), nullable=False, server_default="[]")
        )

    op.execute(
        sa.text(
            """
            UPDATE motorcycles
            SET photos = json_array(photo_url)
            WHERE photo_url IS NOT NULL AND TRIM(photo_url) <> ''
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE motorcycles
            SET photo_url = NULL
            WHERE photos IS NULL OR json_array_length(photos) = 0
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE motorcycles
            SET photo_url = json_extract(photos, '$[0]')
            WHERE photos IS NOT NULL AND json_array_length(photos) > 0
            """
        )
    )

    with op.batch_alter_table("motorcycles") as batch:
        batch.drop_column("photos")