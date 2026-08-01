"""Заглушка для ревизии d0e1f2a3b4c5.

История возникновения
---------------------
В какой-то момент на продовом сервере в таблице ``alembic_version``
осталась ревизия ``d0e1f2a3b4c5`` — по всей видимости, от ранней
попытки миграции email-верификации, которая потом была удалена или
переименована. Из-за этого ``alembic upgrade head`` начал падать с
``Can't locate revision identified by 'd0e1f2a3b4c5'`` и контейнер API
не мог стартовать.

Чтобы не терять данные и не лезть руками в БД на каждом сервере, мы
восстанавливаем эту ревизию как **no-op миграцию** между
``a7b8c9d0e1f2`` (events_end_date) и ``b8c9d0e1f2a3``
(email_verification). Никаких изменений схемы она не делает — только
даёт alembic-у корректно распознать текущую версию и подняться до
head.

Если вы работаете с чистой БД — миграция просто пройдёт мимо, ничего
не сломав.
"""
from __future__ import annotations

from typing import Union


# revision identifiers, used by Alembic.
revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, tuple[str, ...], None] = None
depends_on: Union[str, tuple[str, ...], None] = None


def upgrade() -> None:
    """No-op: только «закрывает» осиротевшую ревизию d0e1f2a3b4c5."""
    pass


def downgrade() -> None:
    """No-op."""
    pass
