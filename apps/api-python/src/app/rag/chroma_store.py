"""Chroma 向量库封装：httpx 直调 REST（对齐 rag-core/vectorstore/chroma-store.ts 行为）。

行为要点：
  - 向量 id 用 metadata.chunkId（规则 "<文档id>-<序号>"）；
  - 检索可带 where { knowledgeBaseId } 实现多租户隔离；
  - Chroma 返回距离（越小越相似），分数换算 score = 1 / (1 + distance)；
  - metadata 里的 distance 一并带回（前端 trace 展示用）。

采用 v2 REST（与 chromadb 官方客户端同协议），无需引入沉重的 chromadb Python 包。
"""

from __future__ import annotations

import httpx

from app.rag import ollama_client

TIMEOUT = 60.0


def _sanitize_metadata(metadata: dict) -> dict:
    """Chroma 只接受 str/int/float/bool 元数据值；None 直接剔除（等价 JS 里 undefined 被序列化丢弃）。"""
    return {key: value for key, value in dict(metadata or {}).items() if value is not None}


class ChromaStore:
    def __init__(self, base_url: str, collection_id: str, knowledge_base_id: str | None) -> None:
        self._base = base_url.rstrip("/") + "/api/v2/tenants/default_tenant/databases/default_database"
        self._collection_id = collection_id
        self.knowledge_base_id = knowledge_base_id

    @classmethod
    def create(cls, collection_name: str, url: str,
               knowledge_base_id: str | None = None) -> "ChromaStore":
        base = url.rstrip("/") + "/api/v2/tenants/default_tenant/databases/default_database"
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.get(f"{base}/collections/{collection_name}")
            if response.status_code == 404:
                response = client.post(f"{base}/collections", json={"name": collection_name})
            response.raise_for_status()
            collection_id = response.json()["id"]
        return cls(url, collection_id, knowledge_base_id)

    def add_documents(self, chunks: list[dict]) -> None:
        if not chunks:
            return
        ids = [str(chunk["metadata"].get("chunkId")) for chunk in chunks]
        embeddings = ollama_client.embed_documents([chunk["pageContent"] for chunk in chunks])
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(
                f"{self._base}/collections/{self._collection_id}/add",
                json={
                    "ids": ids,
                    "embeddings": embeddings,
                    "documents": [chunk["pageContent"] for chunk in chunks],
                    "metadatas": [_sanitize_metadata(chunk["metadata"]) for chunk in chunks],
                },
            )
            response.raise_for_status()

    def search(self, query: str, k: int) -> list[dict]:
        embedding = ollama_client.embed_query(query)
        payload = {
            "query_embeddings": [embedding],
            "n_results": k,
            "include": ["documents", "metadatas", "distances"],
        }
        if self.knowledge_base_id:
            payload["where"] = {"knowledgeBaseId": self.knowledge_base_id}
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(
                f"{self._base}/collections/{self._collection_id}/query", json=payload
            )
            response.raise_for_status()
            data = response.json()

        ids = data.get("ids") or [[]]
        documents = (data.get("documents") or [[]])[0]
        metadatas = (data.get("metadatas") or [[]])[0]
        distances = (data.get("distances") or [[]])[0]
        id_list = ids[0]

        results = []
        for index, page_content in enumerate(documents):
            metadata = dict(metadatas[index] or {})
            distance = distances[index] if index < len(distances) else 0.0
            results.append(
                {
                    "id": str(metadata.get("chunkId", id_list[index] if index < len(id_list) else index)),
                    "pageContent": page_content,
                    "score": 1 / (1 + distance),
                    "metadata": {**metadata, "distance": distance},
                }
            )
        return results

    def delete_ids(self, ids: list[str]) -> None:
        if not ids:
            return
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(
                f"{self._base}/collections/{self._collection_id}/delete",
                json={"ids": ids},
            )
            response.raise_for_status()
