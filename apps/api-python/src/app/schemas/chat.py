"""问答 DTO：对齐 chat.controller.ts 的 QueryDto（mode 三选一、topK 1~20、rerank 布尔）。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ChatQueryDto(BaseModel):
    model_config = ConfigDict(extra="ignore")

    knowledgeBaseId: str
    query: str
    mode: str | None = None
    topK: int | None = Field(default=None, ge=1, le=20)
    rerank: bool | None = None

    @field_validator("knowledgeBaseId")
    @classmethod
    def _kb(cls, value: str) -> str:
        if not value:
            raise ValueError("knowledgeBaseId should not be empty")
        return value

    @field_validator("query")
    @classmethod
    def _query(cls, value: str) -> str:
        if not value:
            raise ValueError("query should not be empty")
        return value

    @field_validator("mode")
    @classmethod
    def _mode(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if value not in ("vector", "bm25", "hybrid"):
            raise ValueError("mode must be one of the following values: vector, bm25, hybrid")
        return value
