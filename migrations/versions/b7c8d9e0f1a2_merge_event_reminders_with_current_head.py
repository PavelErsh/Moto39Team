"""merge event reminders with current head

Revision ID: b7c8d9e0f1a2
Revises: 435b2e2362cb, a1f4c7d9e2b3
Create Date: 2026-08-17 00:20:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "b7c8d9e0f1a2"
down_revision: str | Sequence[str] | None = (
    "435b2e2362cb",
    "a1f4c7d9e2b3",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
