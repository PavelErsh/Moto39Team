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
"""
from __future__ import annotations

import argparse
import asyncio
from typing import Optional

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
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

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    exit_code = asyncio.run(args.func(args))
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
