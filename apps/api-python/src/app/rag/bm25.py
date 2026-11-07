"""BM25 关键词检索器：逐行移植 rag-core/retrieval/bm25-retriever.ts。

打分公式（k1=1.2、b=0.75，IDF +0.5 平滑）：
  score = Σ IDF(词) × (tf × (k1+1)) / (tf + k1 × (1 - b + b × |d|/avgdl))

分词：Node 版用 Intl.Segmenter('zh', word)（isWordLike 过滤标点/空白），
这里用 jieba + "含字母或数字"过滤等价实现（词粒度略有差异，不影响算法正确性）。
"""

from __future__ import annotations

import math

import jieba

K1 = 1.2
B = 0.75


def tokenize(text: str) -> list[str]:
    lowered = text.lower()
    return [
        token
        for token in jieba.cut(lowered)
        if token.strip() and any(char.isalnum() for char in token)
    ]


class Bm25Retriever:
    def __init__(self, documents: list[dict]) -> None:
        self.documents = documents
        self.term_frequency: list[dict[str, int]] = []
        self.document_frequency: dict[str, int] = {}
        lengths: list[int] = []
        for document in documents:
            frequencies: dict[str, int] = {}
            for term in tokenize(document["pageContent"]):
                frequencies[term] = frequencies.get(term, 0) + 1
            for term in frequencies:
                self.document_frequency[term] = self.document_frequency.get(term, 0) + 1
            self.term_frequency.append(frequencies)
            lengths.append(len(tokenize(document["pageContent"])))
        self.lengths = lengths
        self.average_length = (sum(lengths) / len(documents)) if documents else 0

    def search(self, query: str, k: int) -> list[dict]:
        terms = tokenize(query)
        total = len(self.documents)
        scored: list[dict] = []
        for index, document in enumerate(self.documents):
            length = self.lengths[index] or 1
            score = 0.0
            for term in terms:
                frequency = self.term_frequency[index].get(term, 0)
                if not frequency:
                    continue
                df = self.document_frequency.get(term, 0)
                idf = math.log(1 + (total - df + 0.5) / (df + 0.5))
                score += idf * (
                    (frequency * (K1 + 1))
                    / (frequency + K1 * (1 - B + (B * length) / max(self.average_length, 1)))
                )
            if score > 0:
                scored.append(
                    {
                        "id": str(document["metadata"].get("chunkId", index)),
                        "pageContent": document["pageContent"],
                        "score": score,
                        "metadata": document["metadata"],
                    }
                )
        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored[:k]
