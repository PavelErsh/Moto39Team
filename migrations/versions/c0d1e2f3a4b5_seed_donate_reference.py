"""seed «donate» reference article

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-08-04 15:00:00.000000

Мотивация
---------
На главной (странице «пейджер») кнопка «ДОНАТ» ведёт на статью мотосправки
с slug ``donate`` (см. ``frontend/src/pages/HomePage.tsx``). Чтобы контент
про поддержку проекта был доступен сразу после развёртывания,
идемпотентно (upsert-ом) создаём/обновляем статью с этим slug.

Текст статьи в этой миграции — только для баз, где записи ещё нет.
Актуальный текст всегда пере-накатывается более поздней миграцией
``e2f3a4b5c6d7_refresh_donate_content``, чтобы правки контента
доезжали до продакшна даже после первого применения.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c0d1e2f3a4b5"
down_revision: Union[str, None] = "b9c0d1e2f3a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DONATE_SLUG = "donate"
DONATE_TITLE = "Донат — поддержка проекта"
DONATE_CATEGORY = "О проекте"
# summary в UI на пейджере не используется — оставляем пустым.
DONATE_SUMMARY: str | None = None
DONATE_CONTENT = (
    "Приложение разработал Павел Ершов (@Pavel_Er) "
    "при задумке и поддержке Антона Кириллова (@CrazyTony39).\n"
    "\n"
    "Вы можете поддержать проект, переведя любую сумму на карту:\n"
    "2200 7020 7160 7555 Т-Банк Ершов Павел Павлович\n"
    "\n"
)


def _references_table_exists(bind) -> bool:
    return "references" in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if not _references_table_exists(bind):
        # На таких старых базах, где таблицы ещё нет, эта миграция —
        # no-op; создание таблицы делает d4e5f6a7b8c9_references.
        return

    references = sa.table(
        "references",
        sa.column("id", sa.Integer),
        sa.column("slug", sa.String),
        sa.column("title", sa.String),
        sa.column("category", sa.String),
        sa.column("summary", sa.String),
        sa.column("content", sa.Text),
        sa.column("cover_image_url", sa.String),
        sa.column("images", sa.JSON),
        sa.column("created_by", sa.Integer),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )

    existing_id = bind.execute(
        sa.select(references.c.id).where(references.c.slug == DONATE_SLUG)
    ).scalar()

    if existing_id is None:
        bind.execute(
            references.insert().values(
                slug=DONATE_SLUG,
                title=DONATE_TITLE,
                category=DONATE_CATEGORY,
                summary=DONATE_SUMMARY,
                content=DONATE_CONTENT,
                cover_image_url=None,
                images=[],
                created_by=None,
                created_at=sa.func.now(),
                updated_at=sa.func.now(),
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    if not _references_table_exists(bind):
        return
    references = sa.table(
        "references",
        sa.column("slug", sa.String),
    )
    bind.execute(
        references.delete().where(references.c.slug == DONATE_SLUG)
    )
