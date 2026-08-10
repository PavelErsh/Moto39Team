"""chat_member_notifications

Revision ID: f1e2d3c4b5a6
Revises: d92fb37bdee9
Create Date: 2026-08-10 22:10:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1e2d3c4b5a6'
down_revision: Union[str, None] = 'd92fb37bdee9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('chat_members') as batch_op:
        batch_op.add_column(
            sa.Column(
                'notifications_enabled',
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table('chat_members') as batch_op:
        batch_op.drop_column('notifications_enabled')