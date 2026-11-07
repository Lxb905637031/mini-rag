"""种子脚本：对齐 apps/api/prisma/seed.ts。

  1) 幂等创建管理员（ADMIN_USERNAME/ADMIN_PASSWORD，bcrypt cost 10，已存在则不覆盖密码）；
  2) 保证管理员角色为 ADMIN；
  3) 把 ownerId 为空的历史知识库回填给管理员。

运行：cd apps/api-python && uv run python seed.py
"""

from __future__ import annotations

from sqlalchemy import select, update

from app.core.config import get_settings
from app.core.ids import new_id
from app.core.security import hash_password
from app.db.models import KnowledgeBase, User, utcnow
from app.db.session import SessionLocal


def main() -> None:
    settings = get_settings()
    username = settings.admin_username
    password = settings.admin_password

    with SessionLocal() as session:
        existing = session.scalar(select(User).where(User.username == username))
        if existing is None:
            now = utcnow()
            admin = User(
                id=new_id(),
                username=username,
                password_hash=hash_password(password),
                display_name=username,
                role="ADMIN",
                created_at=now,
                updated_at=now,
            )
            session.add(admin)
            session.commit()
            print(f"已创建管理员：{username}")
        else:
            admin = existing
            print(f"管理员已存在：{username}（保留现有密码）")

        if admin.role != "ADMIN":
            session.execute(
                update(User).where(User.id == admin.id).values(role="ADMIN", updated_at=utcnow())
            )
            session.commit()

        backfilled = session.execute(
            update(KnowledgeBase)
            .where(KnowledgeBase.owner_id.is_(None))
            .values(owner_id=admin.id, updated_at=utcnow())
        )
        session.commit()
        print(f"回填历史知识库 {backfilled.rowcount} 个")


if __name__ == "__main__":
    main()
