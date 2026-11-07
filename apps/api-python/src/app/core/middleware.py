"""统一信封中间件：对齐 Node 版 拦截器(no-store/requestId/访问日志) + 响应包装。

为什么用中间件而不是自定义路由类：FastAPI 0.16x 的 include_router 懒加载机制
会丢失自定义 route_class；中间件方案在任何版本都稳定生效。

规则：
  - 所有响应加 Cache-Control: no-store，回写 x-request-id（优先沿用请求头）；
  - 状态码 < 400 且 JSON 响应 → 包装成统一成功信封 + 打访问日志；
  - 状态码 >= 400（异常处理器已生成错误信封）原样放行，不重复包装；
  - /docs、/openapi.json 等文档端点不包装。
"""

from __future__ import annotations

import json
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.responses import build_meta, log_access, success_body

DOCS_PATH_PREFIXES = ("/openapi", "/docs", "/redoc")


class EnvelopeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request.state.request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.started_at = time.time()

        response = await call_next(request)
        response.headers["x-request-id"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"

        content_type = response.headers.get("content-type", "")
        path = request.url.path
        if (
            response.status_code < 400
            and content_type.startswith("application/json")
            and not path.startswith(DOCS_PATH_PREFIXES)
        ):
            body = b""
            async for chunk in response.body_iterator:
                body += chunk if isinstance(chunk, bytes) else chunk.encode()
            data = json.loads(body) if body else None
            meta = build_meta(request, request.state.started_at)
            log_access(request.method, response.status_code, meta)
            wrapped = JSONResponse(content=success_body(data, meta),
                                   status_code=response.status_code)
            # 保留路由层设置的额外响应头（set-cookie 等）。
            for key, value in response.headers.items():
                if key.lower() not in wrapped.headers:
                    wrapped.headers[key] = value
            return wrapped
        return response
