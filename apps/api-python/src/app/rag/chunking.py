"""文档切块：四种策略，逐行移植 rag-core/chunking/chunking.ts。

  fixed      固定字符滑窗（步长 = size - overlap，trim 后跳过空块）；
  recursive  递归按段落/换行/句子边界切（langchain-textsplitters，与 JS 版同一实现、
             相同默认分隔符 ["\\n\\n", "\\n", " ", ""]）；
  semantic   按句末标点分句 → 全部句向量 → 相邻句余弦相似度 < 0.72 或累计超长断块；
  structure  按 Markdown 标题分章节再定长切，metadata.structure 记录所属标题。
"""

from __future__ import annotations

import math
import re

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.rag import ollama_client

SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？.!?])\s+")
HEADING_SPLIT_RE = re.compile(r"(?=^#{1,6}\s)", re.MULTILINE)
HEADING_RE = re.compile(r"^#{1,6}\s+(.+)", re.MULTILINE)

SEMANTIC_SIMILARITY_THRESHOLD = 0.72


def chunk_documents(documents: list[dict], strategy: str, size: int, overlap: int) -> list[dict]:
    if strategy == "fixed":
        return _fixed_chunks(documents, size, overlap)
    if strategy == "semantic":
        return _semantic_chunks(documents, size)
    if strategy == "structure":
        return _structure_chunks(documents, size, overlap)
    # 兜底（含 recursive）。
    splitter = RecursiveCharacterTextSplitter(chunk_size=size, chunk_overlap=overlap)
    chunks: list[dict] = []
    for document in documents:
        for piece in splitter.split_text(document["pageContent"]):
            piece = piece.strip()
            if piece:
                chunks.append({"pageContent": piece, "metadata": dict(document["metadata"])})
    return chunks


def _sliding_windows(text: str, size: int, overlap: int) -> list[str]:
    pieces = []
    step = size - overlap
    start = 0
    while start < len(text):
        piece = text[start : start + size].strip()
        if piece:
            pieces.append(piece)
        start += step
    return pieces


def _fixed_chunks(documents: list[dict], size: int, overlap: int) -> list[dict]:
    chunks = []
    for document in documents:
        for piece in _sliding_windows(document["pageContent"], size, overlap):
            chunks.append({"pageContent": piece, "metadata": dict(document["metadata"])})
    return chunks


def _semantic_chunks(documents: list[dict], size: int) -> list[dict]:
    result: list[dict] = []
    for document in documents:
        sentences = [s for s in SENTENCE_SPLIT_RE.split(document["pageContent"]) if s]
        if len(sentences) < 2:
            result.append({"pageContent": document["pageContent"].strip(),
                           "metadata": dict(document["metadata"])})
            continue

        vectors = ollama_client.embed_documents(sentences)
        current = sentences[0]
        for index in range(1, len(sentences)):
            similarity = _cosine(vectors[index - 1], vectors[index])
            if similarity < SEMANTIC_SIMILARITY_THRESHOLD or len(current) + len(sentences[index]) > size:
                result.append({"pageContent": current.strip(),
                               "metadata": dict(document["metadata"])})
                current = sentences[index]
            else:
                current = f"{current} {sentences[index]}"
        if current.strip():
            result.append({"pageContent": current.strip(),
                           "metadata": dict(document["metadata"])})
    return result


def _structure_chunks(documents: list[dict], size: int, overlap: int) -> list[dict]:
    chunks = []
    for document in documents:
        for section in HEADING_SPLIT_RE.split(document["pageContent"]):
            content = section.strip()
            if not content:
                continue
            heading_match = HEADING_RE.search(section)
            for piece in _sliding_windows(content, size, overlap):
                metadata = {
                    **document["metadata"],
                    "source": str(document["metadata"].get("source", "preview")),
                    "fileName": str(document["metadata"].get("fileName", "preview")),
                }
                if heading_match:
                    metadata["structure"] = heading_match.group(1)
                chunks.append({"pageContent": piece, "metadata": metadata})
    return chunks


def _cosine(a: list[float], b: list[float]) -> float:
    denominator = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(x * x for x in b))
    if denominator == 0:
        return 0.0
    return sum(x * y for x, y in zip(a, b)) / denominator
