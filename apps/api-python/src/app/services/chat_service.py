"""问答业务：移植 apps/api/src/chat/chat.service.ts，并新增 SSE 流式生成。

链路：查知识库（含文档切片）→ 向量通道（Chroma + fileName 修正）+
BM25 通道（DB 切片建内存索引）→ RetrievalService（RRF 融合/重排）
→ 生成（Ollama 非流式 / 流式）。

流式版的关键约束：所有数据库访问必须发生在"准备阶段"（请求/依赖作用域内），
prepare_stream 返回的增量迭代器只消费 Ollama，不再触碰 DB 会话——
因为 StreamingResponse 的迭代可能持续到依赖已关闭之后。
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import not_found
from app.db.models import Chunk, Document, KnowledgeBase
from app.rag import ollama_client
from app.rag.application import RagApplication
from app.rag.bm25 import Bm25Retriever
from app.rag.chroma_store import ChromaStore
from app.rag.generation import AnswerGenerator, build_prompt
from app.rag.reranker import LexicalReranker
from app.rag.retrieval import RetrievalService

NO_EVIDENCE_ANSWER = "我无法从知识库中找到足够依据。"


def _retrieve(session: Session, input: dict, owner_id: str) -> dict:
    """执行检索（vector/bm25/hybrid + 可选重排），返回 trace。query 与 stream 共用。"""
    settings = get_settings()
    knowledge_base_id = input["knowledgeBaseId"]
    query_text = input["query"].strip()
    if not query_text:
        raise ValueError("Query cannot be empty")

    base = session.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.id == knowledge_base_id, KnowledgeBase.owner_id == owner_id
        )
    )
    if base is None:
        raise not_found("Knowledge base not found")

    documents = list(
        session.scalars(
            select(Document).where(Document.knowledge_base_id == knowledge_base_id)
        )
    )
    document_ids = [doc.id for doc in documents]
    chunks = (
        list(
            session.scalars(
                select(Chunk).where(Chunk.document_id.in_(document_ids or [""]))
            )
        )
        if document_ids
        else []
    )

    # 向量检索通道：按 metadata.documentId 用 DB 里的正确文件名覆盖 Chroma 中的旧乱码 fileName。
    file_name_by_document = {doc.id: doc.original_name for doc in documents}
    store = ChromaStore.create(
        settings.chroma_collection, settings.chroma_url, knowledge_base_id
    )

    def vector_search(query_text: str, k: int) -> list[dict]:
        results = store.search(query_text, k)
        for item in results:
            document_id = str(item["metadata"].get("documentId"))
            file_name = file_name_by_document.get(document_id)
            if file_name:
                item["metadata"]["fileName"] = file_name
        return results

    # BM25 通道：把 DB 切片拍平成 { pageContent, metadata } 结构。
    document_by_id = {doc.id: doc for doc in documents}
    corpus = []
    for chunk in chunks:
        metadata = dict(chunk.meta_json or {})
        document = document_by_id.get(chunk.document_id)
        corpus.append(
            {
                "pageContent": chunk.content,
                "metadata": {
                    **metadata,
                    "chunkId": str(metadata.get("chunkId", chunk.id)),
                    "documentId": chunk.document_id,
                    "fileName": document.original_name if document else metadata.get("fileName"),
                },
            }
        )

    retrieval = RetrievalService(vector_search, Bm25Retriever(corpus), LexicalReranker())
    return retrieval.search(
        query_text,
        input.get("mode") or "hybrid",
        input.get("topK") or settings.top_k,
        bool(input.get("rerank")),
    )


def query(session: Session, input: dict, owner_id: str) -> dict:
    """非流式问答：POST /chat/query（保留兼容，行为与 Node 版一致）。"""
    trace = _retrieve(session, input, owner_id)
    generator = AnswerGenerator(ollama_client.chat)
    generated = generator.answer(input["query"].strip(), trace["reranked"])
    return {"answer": generated["answer"], "trace": trace}


def prepare_stream(session: Session, input: dict, owner_id: str) -> tuple[dict, Iterator[str]]:
    """流式问答准备阶段：同步完成全部 DB/检索工作（仍在请求作用域内），
    返回 (trace, 增量文本迭代器)。迭代器只消费 Ollama，可安全跨依赖生命周期使用。"""
    trace = _retrieve(session, input, owner_id)
    prompt = build_prompt(input["query"].strip(), trace["reranked"])
    if not trace["reranked"]:
        # 没有依据时不调模型，直接一次性给兜底文案（与非流式行为一致）。
        return trace, iter([NO_EVIDENCE_ANSWER])
    return trace, ollama_client.chat_stream(prompt)
