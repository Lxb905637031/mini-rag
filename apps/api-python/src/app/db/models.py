"""SQLAlchemy 模型：精确映射 Node 版 Prisma 迁移建的表（apps/api/prisma/migrations/*_init）。

要点：
  - 表名/列名保持 Prisma 生成的 PascalCase / camelCase（PG 里带引号建表），
    因此复用同一个库时新旧代码读写完全兼容；
  - role / status 是 PG 枚举列，这里按 String 处理（写入合法枚举值即可）；
  - created_at / updated_at 由应用层赋值（等价 Prisma @default(now()) / @updatedAt）。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, LargeBinary, String
from sqlalchemy.dialects.postgresql import ENUM, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


# 复用 Prisma 迁移已创建的 PG 枚举类型（create_type=False：只映射、不重建）。
document_status_enum = ENUM(
    "PENDING", "PROCESSING", "COMPLETED", "ERROR",
    name="DocumentStatus", create_type=False,
)
role_enum = ENUM("ADMIN", "USER", name="Role", create_type=False)


def utcnow() -> datetime:
    """当前 UTC 时间（naive）：PG 列是 TIMESTAMP(3) without timezone，Prisma 写入的也是 UTC。"""
    return datetime.utcnow()


class User(Base):
    __tablename__ = "User"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    username: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column("passwordHash", String, nullable=False)
    display_name: Mapped[str | None] = mapped_column("displayName", String, nullable=True)
    role: Mapped[str] = mapped_column(role_enum, nullable=False, default="USER")
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime, nullable=False)


class KnowledgeBase(Base):
    __tablename__ = "KnowledgeBase"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime, nullable=False)
    # ForeignKey 声明让 ORM 感知表间依赖（决定同一事务里的插入顺序）；
    # 库中约束已由 Prisma 迁移建好（含 ON DELETE CASCADE），这里只是对齐映射。
    owner_id: Mapped[str | None] = mapped_column(
        "ownerId", String, ForeignKey("User.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )


class Document(Base):
    __tablename__ = "Document"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    knowledge_base_id: Mapped[str] = mapped_column(
        "knowledgeBaseId", String, ForeignKey("KnowledgeBase.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    original_name: Mapped[str] = mapped_column("originalName", String, nullable=False)
    mime_type: Mapped[str] = mapped_column("mimeType", String, nullable=False)
    content: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    path: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(document_status_enum, nullable=False,
                                        default="PENDING", index=True)
    error_message: Mapped[str | None] = mapped_column("errorMessage", String, nullable=True)
    chunk_count: Mapped[int] = mapped_column("chunkCount", nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime, nullable=False)


class Chunk(Base):
    __tablename__ = "Chunk"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    document_id: Mapped[str] = mapped_column(
        "documentId", String, ForeignKey("Document.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    content: Mapped[str] = mapped_column(String, nullable=False)
    chunk_index: Mapped[int] = mapped_column("chunkIndex", nullable=False)
    page: Mapped[int | None] = mapped_column(nullable=True)
    meta_json: Mapped[dict | list | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, nullable=False)
