"""CLI-утилиты для управления приложением.

Примеры использования:

    # создать нового суперпользователя
    python -m app.cli create-admin --email admin@example.com --username admin --password Secret123!

    # выдать права админа существующему пользователю
    python -m app.cli make-admin --username Ershov

    # снять права
    python -m app.cli revoke-admin --username Ershov

    # показать список пользователей
    python -m app.cli list-users

    # удалить одного пользователя
    python -m app.cli delete-user --username Ershov

    # удалить ВСЕХ пользователей (нужен --yes)
    python -m app.cli delete-all-users --yes

    # удалить всех кроме админов
    python -m app.cli delete-all-users --yes --keep-admins
"""
from __future__ import annotations

import argparse
import asyncio
from typing import Optional

from sqlalchemy import delete, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.email_verification import EmailVerificationCode
from app.models.user import User



async def _find_user(
    email: Optional[str], username: Optional[str]
) -> Optional[User]:
    async with AsyncSessionLocal() as db:
        stmt = select(User)
        if email:
            stmt = stmt.where(User.email == email)
        elif username:
            stmt = stmt.where(User.username == username)
        else:
            return None
        result = await db.execute(stmt)
        return result.scalar_one_or_none()


async def cmd_create_admin(args: argparse.Namespace) -> int:
    async with AsyncSessionLocal() as db:
        existing = await db.execute(
            select(User).where(
                (User.email == args.email) | (User.username == args.username)
            )
        )
        user = existing.scalar_one_or_none()
        if user is not None:
            # Уже есть — просто повысим до админа и (опционально) сбросим пароль.
            user.is_superuser = True
            user.is_active = True
            if args.password:
                user.hashed_password = hash_password(args.password)
            db.add(user)
            await db.commit()
            await db.refresh(user)
            print(
                f"OK: пользователь уже существовал — сделан админом: "
                f"id={user.id} username={user.username} email={user.email}"
            )
            return 0

        user = User(
            email=args.email,
            username=args.username,
            full_name=args.full_name,
            hashed_password=hash_password(args.password),
            is_active=True,
            is_superuser=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        print(
            f"OK: создан админ id={user.id} "
            f"username={user.username} email={user.email}"
        )
        return 0


async def cmd_make_admin(args: argparse.Namespace) -> int:
    user = await _find_user(args.email, args.username)
    if user is None:
        print("Пользователь не найден.")
        return 1
    async with AsyncSessionLocal() as db:
        db_user = await db.get(User, user.id)
        assert db_user is not None
        db_user.is_superuser = True
        db.add(db_user)
        await db.commit()
        print(
            f"OK: пользователь id={db_user.id} "
            f"username={db_user.username} теперь админ."
        )
    return 0


async def cmd_revoke_admin(args: argparse.Namespace) -> int:
    user = await _find_user(args.email, args.username)
    if user is None:
        print("Пользователь не найден.")
        return 1
    async with AsyncSessionLocal() as db:
        db_user = await db.get(User, user.id)
        assert db_user is not None
        db_user.is_superuser = False
        db.add(db_user)
        await db.commit()
        print(
            f"OK: с пользователя id={db_user.id} "
            f"username={db_user.username} сняты права админа."
        )
    return 0


async def cmd_delete_user(args: argparse.Namespace) -> int:
    """Удалить одного пользователя по --email или --username.

    Также вычищает возможный черновик подтверждения email по этому же
    адресу (email_verification_codes), чтобы старый код не мешал
    повторной регистрации с тем же адресом.
    """
    user = await _find_user(args.email, args.username)
    if user is None:
        print("Пользователь не найден.")
        return 1
    async with AsyncSessionLocal() as db:
        db_user = await db.get(User, user.id)
        assert db_user is not None
        uname = db_user.username
        umail = db_user.email
        # Черновики регистрации привязаны по email — удалим на всякий случай.
        if umail:
            await db.execute(
                delete(EmailVerificationCode).where(
                    EmailVerificationCode.email == umail
                )
            )
        await db.delete(db_user)
        await db.commit()
    print(f"OK: удалён пользователь username={uname} email={umail}")
    return 0


async def cmd_delete_all_users(args: argparse.Namespace) -> int:
    """Удалить всех пользователей (осторожно!).

    Требует явного флага ``--yes``. Дополнительно ``--keep-admins`` — не
    трогать записи с is_superuser=True. Заодно очищает
    email_verification_codes, чтобы старые незавершённые регистрации не
    мешали.
    """
    if not args.yes:
        print(
            "Отказано: для массового удаления пользователей нужен флаг "
            "--yes (это необратимо)."
        )
        return 2

    async with AsyncSessionLocal() as db:
        # Собираем список — так работает каскадное удаление связанных
        # сущностей (мотоциклы, локации) через ORM cascade='all,
        # delete-orphan'. Обычный SQL DELETE этого бы не сделал.
        stmt = select(User)
        if args.keep_admins:
            stmt = stmt.where(User.is_superuser.is_(False))
        result = await db.execute(stmt)
        users = list(result.scalars().all())

        deleted = 0
        for u in users:
            await db.delete(u)
            deleted += 1

        # Черновики регистрации не привязаны к пользователю FK-связью —
        # их всегда безопасно вычистить, актуальные для админов кодов
        # там не хранится (после подтверждения запись удаляется).
        await db.execute(delete(EmailVerificationCode))

        await db.commit()

    scope = "всех, кроме админов" if args.keep_admins else "всех"
    print(f"OK: удалено пользователей ({scope}): {deleted}")
    return 0


async def cmd_list_users(_: argparse.Namespace) -> int:
    async with AsyncSessionLocal() as db:

        result = await db.execute(select(User).order_by(User.id))
        users = list(result.scalars().all())
    if not users:
        print("Пользователей нет.")
        return 0
    print(f"{'id':>4}  {'username':20}  {'email':32}  admin  active")
    print("-" * 78)
    for u in users:
        print(
            f"{u.id:>4}  {u.username:20}  {u.email:32}  "
            f"{'yes' if u.is_superuser else 'no ':5}  "
            f"{'yes' if u.is_active else 'no'}"
        )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    p_create = sub.add_parser("create-admin", help="Создать суперпользователя")
    p_create.add_argument("--email", required=True)
    p_create.add_argument("--username", required=True)
    p_create.add_argument("--password", required=True)
    p_create.add_argument("--full-name", default=None)
    p_create.set_defaults(func=cmd_create_admin)

    p_make = sub.add_parser("make-admin", help="Выдать права админа")
    grp = p_make.add_mutually_exclusive_group(required=True)
    grp.add_argument("--email")
    grp.add_argument("--username")
    p_make.set_defaults(func=cmd_make_admin)

    p_rev = sub.add_parser("revoke-admin", help="Снять права админа")
    grp2 = p_rev.add_mutually_exclusive_group(required=True)
    grp2.add_argument("--email")
    grp2.add_argument("--username")
    p_rev.set_defaults(func=cmd_revoke_admin)

    p_list = sub.add_parser("list-users", help="Список пользователей")
    p_list.set_defaults(func=cmd_list_users)

    p_del = sub.add_parser("delete-user", help="Удалить пользователя")
    grp_del = p_del.add_mutually_exclusive_group(required=True)
    grp_del.add_argument("--email")
    grp_del.add_argument("--username")
    p_del.set_defaults(func=cmd_delete_user)

    p_all = sub.add_parser(
        "delete-all-users",
        help="Удалить ВСЕХ пользователей (нужен --yes)",
    )
    p_all.add_argument(
        "--yes",
        action="store_true",
        help="Обязательное подтверждение — операция необратима",
    )
    p_all.add_argument(
        "--keep-admins",
        action="store_true",
        help="Не удалять записи с is_superuser=True",
    )
    p_all.set_defaults(func=cmd_delete_all_users)

    return parser



def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    exit_code = asyncio.run(args.func(args))
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
