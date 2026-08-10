"""message_replies

Revision ID: f2a3b4c5d6e7
Revises: f1e2d3c4b5a6
Create Date: 2026-08-10 22:35:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = 'f1e2d3c4b5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('messages') as batch_op:
        batch_op.add_column(sa.Column('reply_to_message_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_messages_reply_to_message_id_messages',
            'messages',
            ['reply_to_message_id'],
            ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    with op.batch_alter_table('messages') as batch_op:
        batch_op.drop_constraint('fk_messages_reply_to_message_id_messages', type_='foreignkey')
        batch_op.drop_column('reply_to_message_id')