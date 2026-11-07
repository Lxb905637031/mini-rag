"""Ollama 客户端：httpx 直调本地 REST（/api/embed、/api/chat）。

对齐 Node 版：
  - embeddings = @langchain/ollama 的 OllamaEmbeddings（底层就是 POST /api/embed 批量输入）；
  - chat = ChatOllama({ temperature: 0 })（POST /api/chat，stream=false，取 message.content）。
新增：chat_stream 流式生成（stream=true 的 NDJSON 逐行解析），供 SSE 接口使用。
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from functools import lru_cache

import httpx

from app.core.config import get_settings

EMBED_TIMEOUT = 300.0
CHAT_TIMEOUT = 600.0


@lru_cache
def _client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(EMBED_TIMEOUT))


def embed_documents(texts: list[str]) -> list[list[float]]:
    """批量把文本转向量。入库与提问必须用同一个嵌入模型（向量空间才一致）。"""
    settings = get_settings()
    response = _client().post(
        f"{settings.ollama_base_url.rstrip('/')}/api/embed",
        json={"model": settings.embedding_model, "input": texts},
    )
    response.raise_for_status()
    return response.json()["embeddings"]


def embed_query(text: str) -> list[float]:
    return embed_documents([text])[0]


def chat(prompt: str) -> str:
    """对话生成：temperature=0 追求稳定确定的回答（对齐 ChatOllama 配置）。"""
    settings = get_settings()
    with httpx.Client(timeout=httpx.Timeout(CHAT_TIMEOUT)) as client:
        response = client.post(
            f"{settings.ollama_base_url.rstrip('/')}/api/chat",
            json={
                "model": settings.chat_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0},
            },
        )
    response.raise_for_status()
    return response.json()["message"]["content"]


def chat_stream(prompt: str) -> Iterator[str]:
    """流式对话生成：yield 逐段增量文本（Ollama stream=true 时按 NDJSON 逐行返回）。

    与 chat() 同参数（temperature=0）；qwen3 等带思考的模型只透传 message.content，
    thinking 字段不外发——与非流式行为一致。
    """
    settings = get_settings()
    with httpx.Client(timeout=httpx.Timeout(CHAT_TIMEOUT, read=CHAT_TIMEOUT)) as client:
        with client.stream(
            "POST",
            f"{settings.ollama_base_url.rstrip('/')}/api/chat",
            json={
                "model": settings.chat_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
                "options": {"temperature": 0},
            },
        ) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                line = line.strip()
                if not line:
                    continue
                chunk = json.loads(line)
                if chunk.get("done"):
                    break
                content = (chunk.get("message") or {}).get("content")
                if content:
                    yield content
