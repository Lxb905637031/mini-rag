"""文档摄入业务：移植 apps/api/src/ingestion/ingestion.service.ts。

- 上传：文件二进制直接存 Document.content（不落盘），入队索引任务后立即返回 PENDING；
- process：幂等流水线 解析 → recursive 切块（size 封顶 300 / overlap 封顶 40）
  → 向量化写 Chroma → 事务内 删旧切片/写新切片/置 COMPLETED；
- remove：先删队列任务与 Chroma 向量，再删历史磁盘文件（若有），最后删数据库记录。
"""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

from sqlalchemy import delete as sa_delete, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import not_found
from app.core.ids import new_id
from app.db.models import Chunk, Document, KnowledgeBase, utcnow
from app.rag.chunking import chunk_documents
from app.rag.chroma_store import ChromaStore
from app.rag.document_loader import load_document
from app.services.serializers import chunk_row, document_summary
from app.workers.queue import enqueue_index, remove_queued_job

UPLOAD_NAME_RE = re.compile(r"\.(pdf|doc|docx|txt|md|markdown)$", re.IGNORECASE)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _assert_base_owned(session: Session, knowledge_base_id: str, owner_id: str) -> None:
    exists = session.scalar(
        select(KnowledgeBase.id).where(
            KnowledgeBase.id == knowledge_base_id, KnowledgeBase.owner_id == owner_id
        )
    )
    if exists is None:
        raise not_found("Knowledge base not found")


def _assert_document_owned(session: Session, document_id: str, owner_id: str) -> Document:
    document = session.scalar(
        select(Document).where(Document.id == document_id)
    )
    if document is None:
        raise not_found("Document not found")
    _assert_base_owned(session, document.knowledge_base_id, owner_id)
    return document


def fix_filename(original_name: str) -> str:
    """multipart 文件名按 latin1 传输时的中文乱码修复（对齐 Node 版行为；正常名不受影响）。"""
    try:
        fixed = original_name.encode("latin-1").decode("utf-8")
        return fixed
    except (UnicodeEncodeError, UnicodeDecodeError):
        return original_name


def upload(session: Session, knowledge_base_id: str, filename: str, mime_type: str,
           content: bytes, owner_id: str) -> dict:
    _assert_base_owned(session, knowledge_base_id, owner_id)

    now = utcnow()
    document = Document(
        id=new_id(),
        knowledge_base_id=knowledge_base_id,
        original_name=fix_filename(filename),
        mime_type=mime_type or "application/octet-stream",
        path=None,
        content=content,
        status="PENDING",
        chunk_count=0,
        created_at=now,
        updated_at=now,
    )
    session.add(document)
    session.commit()
    session.refresh(document)

    # 入队索引任务（jobId 幂等去重；Redis 故障时接口报错，但记录已落库，
    # 下次 worker 启动自愈会重新入队兜底——与 Node 版闭环一致）。
    enqueue_index(document.id)
    return document_summary(document)


def list_documents(session: Session, knowledge_base_id: str, owner_id: str) -> list[dict]:
    _assert_base_owned(session, knowledge_base_id, owner_id)
    documents = list(
        session.scalars(
            select(Document)
            .where(Document.knowledge_base_id == knowledge_base_id)
            .order_by(Document.created_at.desc())
        )
    )
    return [document_summary(doc) for doc in documents]


def list_chunks(session: Session, document_id: str, owner_id: str) -> list[dict]:
    _assert_document_owned(session, document_id, owner_id)
    chunks = list(
        session.scalars(
            select(Chunk).where(Chunk.document_id == document_id).order_by(Chunk.chunk_index.asc())
        )
    )
    return [chunk_row(chunk) for chunk in chunks]


def remove_document(session: Session, document_id: str, owner_id: str) -> dict:
    _assert_document_owned(session, document_id, owner_id)
    # 顺手清掉还在排队的索引任务（静默；process 对已删文档本来也会直接返回）。
    remove_queued_job(document_id)

    chunks = list(
        session.scalars(select(Chunk.meta_json).where(Chunk.document_id == document_id))
    )
    document = session.get(Document, document_id)
    if document is None:
        raise not_found("Document not found")

    settings = get_settings()
    store = ChromaStore.create(settings.chroma_collection, settings.chroma_url)
    vector_ids = [
        str((meta or {}).get("chunkId", f"{document.id}-{index}"))
        for index, meta in enumerate(chunks)
    ]
    store.delete_ids(vector_ids)

    # 仅历史记录（改造前）会在磁盘留文件；不存在则忽略。
    if document.path:
        try:
            Path(document.path).unlink(missing_ok=True)
        except FileNotFoundError:
            pass

    session.delete(document)  # content 与级联切片一并删除。
    session.commit()
    return {"id": document_id}


def process(session: Session, document_id: str) -> None:
    """文档索引流水线（由 RQ worker 调用）。失败向上抛 → 触发队列重试；
    状态收尾（PENDING 重试中 / ERROR 终局）统一在 app/tasks.py 里做。幂等可重跑。"""
    settings = get_settings()
    document = session.scalar(
        select(Document).where(Document.id == document_id)
    )
    if document is None:
        return  # 排队期间被删除：直接结束。

    session.execute(
        update(Document)
        .where(Document.id == document_id)
        .values(status="PROCESSING", error_message=None, updated_at=utcnow())
    )
    session.commit()

    temp_path: str | None = None
    try:
        file_path = document.path
        if document.content:
            # 解析器只认磁盘文件：先写临时文件（保留原始扩展名），finally 中删除。
            suffix = Path(document.original_name).suffix or ""
            with tempfile.NamedTemporaryFile(
                prefix=f"mini-rag-{document.id}-", suffix=suffix, delete=False
            ) as temp_file:
                temp_file.write(document.content)
                temp_path = temp_file.name
            file_path = temp_path
        if not file_path:
            raise ValueError("文档原始内容缺失：数据库中没有保存文件，请重新上传该文档")

        loaded = load_document(file_path)
        # 把临时路径改写回用户上传时的真实文件名，避免污染切片与向量元数据。
        for item in loaded:
            item["metadata"]["source"] = document.original_name
            item["metadata"]["fileName"] = document.original_name

        chunks = chunk_documents(
            loaded,
            "recursive",
            # 封顶 300/40：保证不超过嵌入模型约 512 token 的上下文窗口。
            size=min(settings.chunk_size, 300),
            overlap=min(settings.chunk_overlap, 40),
        )

        store = ChromaStore.create(settings.chroma_collection, settings.chroma_url)
        prepared = []
        for index, chunk in enumerate(chunks):
            metadata = {
                **chunk["metadata"],
                "chunkId": f"{document.id}-{index}",
                "documentId": document_id,
                "knowledgeBaseId": document.knowledge_base_id,
            }
            prepared.append({"pageContent": chunk["pageContent"], "metadata": metadata})
        store.add_documents(prepared)

        # 事务三连：删旧切片 → 写新切片 → 置 COMPLETED（要么全部成功要么全部回滚）。
        now = utcnow()
        with session.begin():
            session.execute(sa_delete(Chunk).where(Chunk.document_id == document_id))
            for index, chunk in enumerate(prepared):
                metadata = chunk["metadata"]
                session.add(
                    Chunk(
                        id=new_id(),
                        document_id=document_id,
                        content=chunk["pageContent"],
                        chunk_index=index,
                        page=metadata.get("page") if isinstance(metadata.get("page"), int) else None,
                        meta_json=metadata,
                        created_at=now,
                    )
                )
            session.execute(
                update(Document)
                .where(Document.id == document_id)
                .values(status="COMPLETED", chunk_count=len(prepared), updated_at=now)
            )
        session.commit()
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
