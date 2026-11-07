"""知识库 DTO：对齐 knowledge.controller.ts 内联的 CreateKnowledgeDto。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator


class CreateKnowledgeBaseDto(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("name should not be empty")
        return value
