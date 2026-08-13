"""merge heads: chat reactions and engine_cc/donate

Revision ID: fa0b1c2d3e4f
Revises: f3b4c5d6e7f8, f9d0e1f2a3b4
Create Date: 2026-08-13 13:30:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "fa0b1c2d3e4f"
down_revision: Union[str, Sequence[str], None] = (
    "f3b4c5d6e7f8",
    "f9d0e1f2a3b4",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass