"""词面重排器：移植 rag-core/reranking/reranker.ts。

新分数 = 查询词命中数（每命中一个词 +1） + 初筛分 × 0.01（仅作平局裁决）。
"""

from __future__ import annotations


class LexicalReranker:
    def rerank(self, query: str, candidates: list[dict]) -> list[dict]:
        terms = [term for term in query.lower().split() if term]
        scored = []
        for candidate in candidates:
            content = candidate["pageContent"].lower()
            hits = sum(1 for term in terms if term in content)
            scored.append({**candidate, "score": hits + candidate["score"] * 0.01})
        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored
