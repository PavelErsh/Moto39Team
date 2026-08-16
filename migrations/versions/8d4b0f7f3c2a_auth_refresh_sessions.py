"""auth_refresh_sessions

Revision ID: 8d4b0f7f3c2a
Revises: d92fb37bdee9
Create Date: 2026-08-16 20:55:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8d4b0f7f3c2a'
down_revision: Union[str, None] = 'd92fb37bdee9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'auth_refresh_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('jti', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.Column('rotated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_auth_refresh_sessions_id'),
        'auth_refresh_sessions',
        ['id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_auth_refresh_sessions_jti'),
        'auth_refresh_sessions',
        ['jti'],
        unique=True,
    )
    op.create_index(
        op.f('ix_auth_refresh_sessions_user_id'),
        'auth_refresh_sessions',
        ['user_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_auth_refresh_sessions_user_id'), table_name='auth_refresh_sessions')
    op.drop_index(op.f('ix_auth_refresh_sessions_jti'), table_name='auth_refresh_sessions')
    op.drop_index(op.f('ix_auth_refresh_sessions_id'), table_name='auth_refresh_sessions')
    op.drop_table('auth_refresh_sessions')