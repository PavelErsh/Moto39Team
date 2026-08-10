"""message_reactions

Revision ID: f3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-08-10 23:05:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3b4c5d6e7f8'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'message_reactions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('message_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('emoji', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['message_id'], ['messages.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('message_id', 'user_id', 'emoji', name='uq_message_reaction'),
    )
    op.create_index(op.f('ix_message_reactions_id'), 'message_reactions', ['id'], unique=False)
    op.create_index(op.f('ix_message_reactions_message_id'), 'message_reactions', ['message_id'], unique=False)
    op.create_index(op.f('ix_message_reactions_user_id'), 'message_reactions', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_message_reactions_user_id'), table_name='message_reactions')
    op.drop_index(op.f('ix_message_reactions_message_id'), table_name='message_reactions')
    op.drop_index(op.f('ix_message_reactions_id'), table_name='message_reactions')
    op.drop_table('message_reactions')