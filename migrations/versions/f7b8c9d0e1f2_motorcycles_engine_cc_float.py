"""motorcycles: make engine_cc float

Revision ID: f7b8c9d0e1f2
Revises: e0f1a2b3c4d5
Create Date: 2026-08-12 16:35:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "f7b8c9d0e1f2"
down_revision: Union[str, None] = "e0f1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _engine_cc_is_float(bind) -> bool:
    inspector = sa.inspect(bind)
    if "motorcycles" not in inspector.get_table_names():
        return False
    for column in inspector.get_columns("motorcycles"):
        if column["name"] != "engine_cc":
            continue
        return isinstance(column["type"], sa.Float)
    return False


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "motorcycles" not in inspector.get_table_names():
        return
    column_names = {c["name"] for c in inspector.get_columns("motorcycles")}
    if "engine_cc" not in column_names or _engine_cc_is_float(bind):
        return

    with op.batch_alter_table("motorcycles") as batch_op:
        batch_op.alter_column(
            "engine_cc",
            existing_type=sa.Integer(),
            type_=sa.Float(),
            existing_nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "motorcycles" not in inspector.get_table_names():
        return
    column_names = {c["name"] for c in inspector.get_columns("motorcycles")}
    if "engine_cc" not in column_names:
        return

    with op.batch_alter_table("motorcycles") as batch_op:
        batch_op.alter_column(
            "engine_cc",
            existing_type=sa.Float(),
            type_=sa.Integer(),
            existing_nullable=True,
        )