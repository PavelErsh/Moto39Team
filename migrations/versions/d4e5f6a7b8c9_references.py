"""references

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-20 23:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "references",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(length=160), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("summary", sa.String(length=500), nullable=True),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "cover_image_url", sa.String(length=500), nullable=True
        ),
        sa.Column(
            "images",
            sa.JSON(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_references_id"), "references", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_references_slug"),
        "references",
        ["slug"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_references_slug"), table_name="references")
    op.drop_index(op.f("ix_references_id"), table_name="references")
    op.drop_table("references")
