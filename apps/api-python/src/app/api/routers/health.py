"""健康检查路由（对齐 health.controller.ts）：GET /health，公开。

回显依赖地址 + 队列实时统计（waiting/active/delayed/failed，Redis 不可用时为 null）。
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.config import get_settings
from app.workers.queue import queue_counts

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def check() -> dict:
    settings = get_settings()
    return {
        "ok": True,
        "services": {
            "ollama": settings.ollama_base_url,
            "chroma": settings.chroma_url,
            "database": "postgresql",
        },
        "queue": queue_counts(),
    }
