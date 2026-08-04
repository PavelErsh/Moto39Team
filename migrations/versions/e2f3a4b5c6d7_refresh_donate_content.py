"""refresh «donate» reference content

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-08-04 15:50:00.000000

Мотивация
---------
Первый seed «донат»-статьи (c0d1e2f3a4b5) уже применился к продовым базам —
поэтому правки текста в его коде туда больше не доедут. Этой отдельной
миграцией **всегда** пере-накатываем актуальный текст статьи donate,
чтобы правки контента (реквизиты, авторы, инструкции) шли в прод при
следующем ``alembic upgrade head``.

Если админ изменил статью через веб-интерфейс — эта миграция всё равно
перезапишет её на канонический текст. Это осознанный компромисс:
считаем, что текст донат-страницы — часть кода проекта.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
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
    else:
        bind.execute(
            references.update()
            .where(references.c.slug == DONATE_SLUG)
            .values(
                title=DONATE_TITLE,
                category=DONATE_CATEGORY,
                summary=DONATE_SUMMARY,
                content=DONATE_CONTENT,
                updated_at=sa.func.now(),
            )
        )


def downgrade() -> None:
    # Обратный переход бессмысленен: канонический текст не откатываем,
    # чтобы downgrade не затирал контент случайно. No-op.
    pass
