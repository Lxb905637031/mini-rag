"""实验室路由（对齐 lab.controller.ts）：

  GET  /lab/admin-only  RBAC 演示（仅 admin，未登录 401 / 普通用户 403）
  POST /lab/chunks      切块实验：对粘贴文本试切，size 缺省 500、overlap 固定 60；
                        仅 semantic 策略需要嵌入模型。
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, require_roles
from app.rag import chunking
from app.schemas import LabChunkDto

router = APIRouter(prefix="/lab", tags=["lab"])


@router.get("/admin-only")
def admin_only(user: dict = Depends(require_roles("admin"))) -> dict:
    return {"message": "你是 admin，才能看到这条消息"}


@router.post("/chunks")
def preview_chunks(body: LabChunkDto, user: dict = Depends(get_current_user)) -> dict:
    started_at = time.time()
    chunks = chunking.chunk_documents(
        [{"pageContent": body.text, "metadata": {"source": "preview", "fileName": "实验文本"}}],
        body.strategy,
        size=body.size or 500,
        overlap=60,
    )
    return {"chunks": chunks, "durationMs": int((time.time() - started_at) * 1000)}
