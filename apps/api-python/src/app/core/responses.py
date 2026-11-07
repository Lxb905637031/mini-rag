"""统一响应信封的构造工具：对齐 Node 版全局响应拦截器 (api-response.interceptor.ts)。

成功结构：
  { success: true, code: 'OK', message: '请求成功', data: <业务数据>, meta: {...} }
meta:
  { requestId, timestamp(ISO Z), path(含查询串), durationMs }

requestId 规则与 Node 版一致：优先沿用请求头 x-request-id，否则生成 UUID。
实际包装动作在 core/middleware.py 的 EnvelopeMiddleware 中完成。
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from starlette.requests import Request


def now_iso_z() -> str:
    """UTC ISO 字符串，毫秒精度，Z 结尾（等价 JS 的 new Date().toISOString()）。"""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def build_meta(request: Request, started_at: float) -> dict:
    query = request.url.query
    path = request.url.path + (f"?{query}" if query else "")
    return {
        "requestId": getattr(request.state, "request_id", None) or str(uuid.uuid4()),
        "timestamp": now_iso_z(),
        "path": path,
        "durationMs": int((time.time() - started_at) * 1000),
    }


def success_body(data, meta: dict) -> dict:
    return {
        "success": True,
        "code": "OK",
        "message": "请求成功",
        "data": data if data is not None else None,
        "meta": meta,
    }


def log_access(method: str, status: int, meta: dict) -> None:
    """一行 JSON 访问日志（对齐 Node 版 console.info(JSON.stringify(...))）。"""
    import json

    print(
        json.dumps({"type": "api.response", "method": method, "status": status, **meta},
                   ensure_ascii=False),
        flush=True,
    )
