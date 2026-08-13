"""merge heads: engine_cc float and donate refresh

Revision ID: f9d0e1f2a3b4
Revises: e2f3a4b5c6d7, f7b8c9d0e1f2
Create Date: 2026-08-13 13:10:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "f9d0e1f2a3b4"
down_revision: Union[str, Sequence[str], None] = (
    "e2f3a4b5c6d7",
    "f7b8c9d0e1f2",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass