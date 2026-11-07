"""FastAPI 入口：应用工厂 (create_app) + 全局配置，对齐 apps/api/src/main.ts 的行为。

  - 监听 API_PORT（默认 3001），Vite 代理 /api → 3001 无需改动；
  - 所有响应 Cache-Control: no-store + 回写 x-request-id（requestId 优先沿用请求头）；
  - CORS：开发模式放行任意来源（等价 Nest origin: true），生产用 WEB_ORIGINS 白名单；
  - 成功响应由 EnvelopeRoute 包装成统一信封；异常由这里的处理器包装成统一错误信封
    （结构对齐 api-response.interceptor.ts / api-exception.filter.ts）。

运行：uv run uvicorn app.main:app --reload --port 3001
"""

from __future__ import annotations

import json
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routers import auth, chat, health, ingestion, knowledge, lab
from app.core.config import get_settings
from app.core.errors import ApiException
from app.core.middleware import EnvelopeMiddleware
from app.core.responses import now_iso_z
from app.db.session import engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 优雅停机：断开数据库连接池（对齐 Nest enableShutdownHooks 的目的）。
    yield
    engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="mini-rag API (Python)",
        version="1.0.0",
        description="NestJS 版后端的 Python 平替：接口与响应结构 1:1 对齐。",
        lifespan=lifespan,
    )

    _register_middleware(application)
    _register_cors(application, settings.node_env == "production", settings.web_origins_list)
    _register_exception_handlers(application)
    _register_routers(application)
    return application


def _register_cors(application: FastAPI, production: bool, origins: list[str]) -> None:
    """开发模式放行任意来源（等价 Nest origin: true），生产用白名单。"""
    if production:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    else:
        application.add_middleware(
            CORSMiddleware,
            allow_origin_regex=".*",
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )


def _register_middleware(application: FastAPI) -> None:
    # 后注册的在外层：CORS 在最外层（对齐 Nest：CORS → no-store 中间件 → 路由）。
    application.add_middleware(EnvelopeMiddleware)


def _error_body(request: Request, status: int, message: str, *, code: str | None = None,
                error_type: str = "UnknownError") -> JSONResponse:
    """统一错误信封（对齐 api-exception.filter.ts 的结构与日志）。"""
    started_at = getattr(request.state, "started_at", None)
    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())
    meta = {"requestId": request_id, "timestamp": now_iso_z(), "path": request.url.path}
    if started_at is not None:
        meta["durationMs"] = int((time.time() - started_at) * 1000)
    print(
        json.dumps(
            {
                "type": "api.error",
                "method": request.method,
                "status": status,
                "code": code or f"HTTP_{status}",
                "requestId": request_id,
                "path": meta["path"],
                "errorType": error_type,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return JSONResponse(
        content={
            "success": False,
            "code": code or f"HTTP_{status}",
            "message": message,
            "data": None,
            "meta": meta,
            "error": {"type": error_type, "details": message},
        },
        status_code=status,
        headers={"x-request-id": request_id, "Cache-Control": "no-store"},
    )


def _register_exception_handlers(application: FastAPI) -> None:
    @application.exception_handler(ApiException)
    async def api_exception_handler(request: Request, exc: ApiException) -> JSONResponse:
        return _error_body(request, exc.status_code, exc.message,
                           code=exc.code, error_type=exc.name)

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # 校验错误数组用中文分号拼成一句话（对齐过滤器的 message 归一化）。
        messages = []
        for error in exc.errors():
            msg = str(error.get("msg", ""))
            if msg.startswith("Value error, "):
                msg = msg[len("Value error, "):]
            messages.append(msg)
        return _error_body(request, 400, "；".join(messages) or "请求参数不合法",
                           error_type="BadRequestException")

    @application.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "服务器内部错误"
        return _error_body(request, exc.status_code, detail, error_type="HttpException")

    @application.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        return _error_body(request, 500, "服务器内部错误", error_type=type(exc).__name__)


def _register_routers(application: FastAPI) -> None:
    application.include_router(auth.router)
    application.include_router(knowledge.router)
    application.include_router(ingestion.router)
    application.include_router(chat.router)
    application.include_router(health.router)
    application.include_router(lab.router)


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=get_settings().api_port, reload=False)
