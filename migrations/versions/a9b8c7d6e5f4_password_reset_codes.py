"""password reset codes

Revision ID: a9b8c7d6e5f4
Revises: 697085ccbdbd
Create Date: 2026-08-16 12:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a9b8c7d6e5f4"
down_revision = "697085ccbdbd"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_reset_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_password_reset_codes_email"), "password_reset_codes", ["email"], unique=False)
    op.create_index(op.f("ix_password_reset_codes_id"), "password_reset_codes", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_password_reset_codes_id"), table_name="password_reset_codes")
    op.drop_index(op.f("ix_password_reset_codes_email"), table_name="password_reset_codes")
    op.drop_table("password_reset_codes")