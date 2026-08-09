"""merge chat_messaging and emergency_status heads

Revision ID: 697085ccbdbd
Revises: 13cbd3396af6, e0f1a2b3c4d5
Create Date: 2026-08-09 16:54:56.533745

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '697085ccbdbd'
down_revision: Union[str, None] = ('13cbd3396af6', 'e0f1a2b3c4d5')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
