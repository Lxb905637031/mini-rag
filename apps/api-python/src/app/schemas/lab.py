"""实验室 DTO：对齐 lab.controller.ts 的 ChunkPreviewDto（策略四选一、size 100~4000）。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LabChunkDto(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: str
    strategy: str
    size: int | None = Field(default=None, ge=100, le=4000)

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        if not value:
            raise ValueError("text should not be empty")
        return value

    @field_validator("strategy")
    @classmethod
    def _strategy(cls, value: str) -> str:
        if value not in ("fixed", "recursive", "semantic", "structure"):
            raise ValueError(
                "strategy must be one of the following values: fixed, recursive, semantic, structure"
            )
        return value
