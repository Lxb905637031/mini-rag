"""RRF（倒数排名融合）：移植 rag-core/retrieval/rrf.ts。

贡献分 = 权重 / (k + 名次)，k=60；同一 id 多路命中累加；
平局按最早名次稳定排序。
"""

from __future__ import annotations

RRF_K = 60


def reciprocal_rank_fusion(lists: list[list[dict]], weights: list[float] | None = None,
                           rrf_k: int = RRF_K) -> list[dict]:
    if weights is None:
        weights = [1.0] * len(lists)

    merged: dict[str, dict] = {}
    for list_index, results in enumerate(lists):
        weight = weights[list_index] if list_index < len(weights) else 1.0
        for index, result in enumerate(results):
            rank = index + 1
            result_id = result.get("id") or str(
                result["metadata"].get("chunkId", f"{list_index}-{index}")
            )
            score = weight / (rrf_k + rank)
            existing = merged.get(result_id)
            if existing is not None:
                existing["score"] += score
            else:
                merged[result_id] = {
                    "result": {**result, "id": result_id},
                    "score": score,
                    "first_rank": rank,
                }

    ordered = sorted(merged.values(), key=lambda item: (-item["score"], item["first_rank"]))
    return [{**item["result"], "score": item["score"]} for item in ordered]
