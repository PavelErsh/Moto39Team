"""email verification codes table

Revision ID: b8c9d0e1f2a3
Revises: d0e1f2a3b4c5
Create Date: 2026-08-01 00:00:00.000000

"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "d0e1f2a3b4c5"

branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_verification_codes",
        sa.Column(
            "id", sa.Integer(), primary_key=True, nullable=False
        ),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column(
            "attempts",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "last_sent_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_email_verification_codes_email",
        "email_verification_codes",
        ["email"],
    )
    op.create_index(
        "ix_email_verification_codes_id",
        "email_verification_codes",
        ["id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_email_verification_codes_id",
        table_name="email_verification_codes",
    )
    op.drop_index(
        "ix_email_verification_codes_email",
        table_name="email_verification_codes",
    )
    op.drop_table("email_verification_codes")
