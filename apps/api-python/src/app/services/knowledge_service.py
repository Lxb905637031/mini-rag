"""知识库业务：移植 apps/api/src/knowledge/knowledge.service.ts。

多租户隔离规则不变：所有查询带 ownerId 过滤，越权/不存在统一 404
（不泄露他人资源的存在性）。
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import not_found
from app.core.ids import new_id
from app.db.models import Document, KnowledgeBase, utcnow
from app.services.serializers import document_summary, knowledge_base


def list_bases(session: Session, owner_id: str) -> list[dict]:
    bases = list(
        session.scalars(
            select(KnowledgeBase)
            .where(KnowledgeBase.owner_id == owner_id)
            .order_by(KnowledgeBase.updated_at.desc())
        )
    )
    counts = dict(
        session.execute(
            select(Document.knowledge_base_id, func.count())
            .where(Document.knowledge_base_id.in_([base.id for base in bases] or [""]))
            .group_by(Document.knowledge_base_id)
        ).all()
    )
    return [knowledge_base(base, document_count=counts.get(base.id, 0)) for base in bases]


def create_base(session: Session, name: str, owner_id: str) -> dict:
    now = utcnow()
    base = KnowledgeBase(id=new_id(), name=name, owner_id=owner_id,
                         created_at=now, updated_at=now)
    session.add(base)
    session.commit()
    session.refresh(base)
    return knowledge_base(base)


def _get_owned(session: Session, base_id: str, owner_id: str) -> KnowledgeBase:
    base = session.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.id == base_id, KnowledgeBase.owner_id == owner_id
        )
    )
    if base is None:
        raise not_found("Knowledge base not found")
    return base


def get_base(session: Session, base_id: str, owner_id: str) -> dict:
    base = _get_owned(session, base_id, owner_id)
    documents = list(
        session.scalars(
            select(Document)
            .where(Document.knowledge_base_id == base_id)
            .order_by(Document.created_at.asc())
        )
    )
    # 摘要不含 content 二进制（Node 版 include documents 会带 BLOB，前端未使用该接口，这里返回干净摘要）。
    return knowledge_base(base, documents=[document_summary(doc) for doc in documents])


def remove_base(session: Session, base_id: str, owner_id: str) -> dict:
    base = _get_owned(session, base_id, owner_id)
    data = knowledge_base(base)
    session.delete(base)  # 级联删除文档与切片（数据库外键 ON DELETE CASCADE）。
    session.commit()
    return data
