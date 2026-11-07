"""认证路由（对齐 auth.controller.ts）：

  POST /auth/register  公开，注册即登录（自动建默认知识库）
  POST /auth/login     公开
  GET  /auth/profile   需令牌
  POST /auth/logout    需令牌，令牌写入 Redis 黑名单
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.errors import unauthorized
from app.db.session import get_db
from app.schemas import LoginDto, RegisterDto
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register")
def register(body: RegisterDto, session: Session = Depends(get_db)) -> dict:
    return auth_service.register(session, body.username, body.password, body.displayName)


@router.post("/login")
def login(body: LoginDto, session: Session = Depends(get_db)) -> dict:
    return auth_service.login(session, body.username, body.password)


@router.get("/profile")
def profile(user: dict = Depends(get_current_user), session: Session = Depends(get_db)) -> dict:
    return auth_service.profile(session, user["id"])


@router.post("/logout")
def logout(request: Request, user: dict = Depends(get_current_user)) -> dict:
    auth_header = request.headers.get("authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise unauthorized("缺少登录令牌")
    token = auth_header[len("Bearer "):].strip()
    return auth_service.logout(token)
