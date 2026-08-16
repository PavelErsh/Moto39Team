"""merge password reset with current head

Revision ID: b1c2d3e4f5a6
Revises: a9b8c7d6e5f4, fab1c2d3e4f5
Create Date: 2026-08-16 12:55:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, Sequence[str], None] = (
    "a9b8c7d6e5f4",
    "fab1c2d3e4f5",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass