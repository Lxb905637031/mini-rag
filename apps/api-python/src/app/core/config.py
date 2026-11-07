"""统一配置中心：读取 .env / 环境变量 → 校验 → 供全部模块使用。

对齐 Node 版两处配置来源：
  - rag-core/src/config.ts 的 loadConfig()（RAG 参数，正整数校验、overlap < size 校验）；
  - apps/api 的 main.ts / auth.module / redis.service（API_PORT、CORS、JWT、Redis）。

.env 文件按本文件所在目录（apps/api-python/.env）解析，与运行时的工作目录无关。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[3]  # apps/api-python（.env 与项目根）


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        # 各字段的 env 变量名与 Node 版完全一致（apps/api/.env 可直接共用）。
        populate_by_name=True,
    )

    # ---- 基础设施（字段名与变量名一致，无需别名）----
    database_url: str = "postgresql://mini_rag:mini_rag@127.0.0.1:5432/mini_rag?schema=public"
    redis_url: str = "redis://127.0.0.1:6379"
    chroma_url: str = "http://127.0.0.1:8000"
    chroma_collection: str = "mini_rag_documents"
    ollama_base_url: str = "http://127.0.0.1:11434"

    # ---- 模型（env 变量带 OLLAMA_ 前缀）----
    chat_model: str = Field(default="llama3.2:3b", validation_alias="OLLAMA_CHAT_MODEL")
    embedding_model: str = Field(
        default="mxbai-embed-large", validation_alias="OLLAMA_EMBEDDING_MODEL"
    )

    # ---- RAG 参数（env 变量带 RAG_ 前缀；校验对齐 rag-core/config.ts）----
    top_k: int = Field(default=4, gt=0, validation_alias="RAG_TOP_K")
    chunk_size: int = Field(default=300, gt=0, validation_alias="RAG_CHUNK_SIZE")
    chunk_overlap: int = Field(default=40, gt=0, validation_alias="RAG_CHUNK_OVERLAP")

    # ---- HTTP / CORS ----
    api_port: int = 3001
    web_origin: str | None = None
    web_origins: str | None = None
    node_env: str | None = None

    # ---- JWT / 种子管理员 ----
    jwt_secret: str = "mini-rag-dev-only-secret"
    jwt_expires_in: str = "1h"
    admin_username: str = "admin"
    admin_password: str = "admin123"

    @model_validator(mode="after")
    def _check_overlap(self) -> "Settings":
        # 对齐 rag-core/config.ts：重叠必须小于块大小，否则切块逻辑会退化。
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE")
        return self

    @field_validator("web_origin", "web_origins", "node_env", mode="before")
    @classmethod
    def _empty_str_to_none(cls, value):
        # .env 里留空时按未配置处理。
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def web_origins_list(self) -> list[str]:
        """CORS 白名单：优先 WEB_ORIGINS（逗号分隔），其次 WEB_ORIGIN，兜底 Vite 默认地址。"""
        configured = self.web_origins or self.web_origin or "http://localhost:5173"
        return [origin.strip() for origin in configured.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
