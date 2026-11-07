"""RAG 总编排：移植 rag-core/rag.ts。检索 → 用 trace.reranked 生成 → 返回 {answer, trace}。"""

from __future__ import annotations

from app.rag.generation import AnswerGenerator
from app.rag.retrieval import RetrievalService


class RagApplication:
    def __init__(self, retrieval: RetrievalService, generator: AnswerGenerator) -> None:
        self.retrieval = retrieval
        self.generator = generator

    def answer_question(self, query: str, mode: str, top_k: int,
                        rerank: bool | None = None) -> dict:
        if not query.strip():
            raise ValueError("Query cannot be empty")
        trimmed = query.strip()
        trace = self.retrieval.search(trimmed, mode, top_k, bool(rerank))
        generated = self.generator.answer(trimmed, trace["reranked"])
        return {"answer": generated["answer"], "trace": trace}
