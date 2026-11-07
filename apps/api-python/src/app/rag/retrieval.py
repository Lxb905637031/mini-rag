"""检索编排器：移植 rag-core/retrieval/retrieval-service.ts。

流程：每路取 k×2 候选 → hybrid 用 RRF 融合（权重 0.7/0.3 偏向量）
→ 融合为空则兜底合并两路原始结果 → 可选重排 → 截取前 k 条 → 产出 trace。
"""

from __future__ import annotations

import time

from app.rag.bm25 import Bm25Retriever
from app.rag.reranker import LexicalReranker
from app.rag.rrf import reciprocal_rank_fusion


class RetrievalService:
    def __init__(self, vector_search, bm25: Bm25Retriever, reranker: LexicalReranker) -> None:
        self.vector_search = vector_search
        self.bm25 = bm25
        self.reranker = reranker

    def search(self, query: str, mode: str, k: int, use_rerank: bool = False) -> dict:
        started_at = time.time()
        vector = [] if mode == "bm25" else self.vector_search(query, k * 2)
        bm25 = [] if mode == "vector" else self.bm25.search(query, k * 2)

        if mode == "hybrid":
            fused = reciprocal_rank_fusion([vector, bm25], [0.7, 0.3])
        elif mode == "vector":
            fused = vector
        else:
            fused = bm25

        base = (fused if fused else [*vector, *bm25])[: k * 2]
        reranked = self.reranker.rerank(query, base) if use_rerank else base
        return {
            "mode": mode,
            "vector": vector,
            "bm25": bm25,
            "fused": fused,
            "reranked": reranked[:k],
            "durationMs": int((time.time() - started_at) * 1000),
        }
