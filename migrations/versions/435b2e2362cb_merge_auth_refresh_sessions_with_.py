"""merge auth_refresh_sessions with current head

Revision ID: 435b2e2362cb
Revises: 8d4b0f7f3c2a, b1c2d3e4f5a6
Create Date: 2026-08-16 21:17:05.578669

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '435b2e2362cb'
down_revision: Union[str, None] = ('8d4b0f7f3c2a', 'b1c2d3e4f5a6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
