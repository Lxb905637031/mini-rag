"""问答路由：POST /chat/query（非流式，兼容保留）+ POST /chat/query/stream（SSE 流式）。

SSE 事件协议（每帧为 `data: {json}\n\n`）：
  {"type":"trace","trace":{...}}          检索完成即下发（前端可先渲染"检索依据"面板）
  {"type":"delta","content":"..."}        答案增量文本（逐 token）
  {"type":"done","answer":"...","trace":{...}}  结束：完整答案 + 完整 trace
  {"type":"error","message":"..."}        生成中途失败（此时 HTTP 已是 200，只能靠事件通知）
"""

from __future__ import annotations

import json
from collections.abc import Iterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.schemas import ChatQueryDto
from app.services import chat_service

router = APIRouter(prefix="/chat", tags=["chat"])


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/query")
def query(body: ChatQueryDto, user: dict = Depends(get_current_user),
          session: Session = Depends(get_db)) -> dict:
    return chat_service.query(session, body.model_dump(), user["id"])


@router.post("/query/stream")
def query_stream(body: ChatQueryDto, user: dict = Depends(get_current_user),
                 session: Session = Depends(get_db)) -> StreamingResponse:
    # 准备阶段同步完成全部 DB/检索工作；流式阶段只消费 Ollama（见 chat_service.prepare_stream）。
    trace, deltas = chat_service.prepare_stream(session, body.model_dump(), user["id"])

    def event_stream() -> Iterator[str]:
        answer_parts: list[str] = []
        yield _sse({"type": "trace", "trace": trace})
        try:
            for delta in deltas:
                answer_parts.append(delta)
                yield _sse({"type": "delta", "content": delta})
        except Exception:
            yield _sse({"type": "error", "message": "答案生成失败，请稍后重试"})
            return
        yield _sse({"type": "done", "answer": "".join(answer_parts), "trace": trace})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        # X-Accel-Buffering: 反向代理（nginx 等）不要缓冲本响应；no-cache 防中间层缓存。
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
