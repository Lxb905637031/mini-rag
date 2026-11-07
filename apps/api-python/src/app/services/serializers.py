"""序列化：ORM 对象 → 与 Node 版 JSON 完全一致的字典（时间统一 UTC ISO Z、毫秒精度）。"""

from __future__ import annotations

from datetime import datetime, timezone

from app.db.models import Chunk, Document, KnowledgeBase, User


def iso_z(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def safe_user(user: User) -> dict:
    """对外的用户信息（刻意不含 passwordHash）。"""
    return {
        "id": user.id,
        "username": user.username,
        "displayName": user.display_name,
        "createdAt": iso_z(user.created_at),
    }


def knowledge_base(item: KnowledgeBase, *, document_count: int | None = None,
                   documents: list[dict] | None = None) -> dict:
    data = {
        "id": item.id,
        "name": item.name,
        "createdAt": iso_z(item.created_at),
        "updatedAt": iso_z(item.updated_at),
        "ownerId": item.owner_id,
    }
    if document_count is not None:
        data["_count"] = {"documents": document_count}
    if documents is not None:
        data["documents"] = documents
    return data


def document_summary(doc: Document) -> dict:
    """文档摘要白名单（不含 content 二进制大字段），对齐 documentSummarySelect。"""
    return {
        "id": doc.id,
        "knowledgeBaseId": doc.knowledge_base_id,
        "originalName": doc.original_name,
        "mimeType": doc.mime_type,
        "path": doc.path,
        "status": doc.status,
        "errorMessage": doc.error_message,
        "chunkCount": doc.chunk_count,
        "createdAt": iso_z(doc.created_at),
        "updatedAt": iso_z(doc.updated_at),
    }


def chunk_row(chunk: Chunk) -> dict:
    return {
        "id": chunk.id,
        "documentId": chunk.document_id,
        "content": chunk.content,
        "chunkIndex": chunk.chunk_index,
        "page": chunk.page,
        "metadata": chunk.meta_json,
        "createdAt": iso_z(chunk.created_at),
    }
