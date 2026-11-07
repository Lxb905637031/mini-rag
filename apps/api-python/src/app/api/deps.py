"""鉴权依赖：复刻 JwtAuthGuard + RolesGuard（认证/鉴权分离）。

- get_current_user：解析 Bearer 令牌 → 验签（失败 401 "登录已失效"）
  → 查 Redis 黑名单（命中 401 "登录状态已退出"）→ 返回 {id, username, role}；
- 公开接口（register/login/health）不注入该依赖即可（等价 @Public()）；
- require_roles：RBAC 角色检查（失败 403），等价 @Roles(...) + RolesGuard。
"""

from __future__ import annotations

import jwt as pyjwt
from fastapi import Depends, Request

from app.core.errors import forbidden, unauthorized
from app.core.redis_client import is_token_blacklisted
from app.core.security import sha256_hex, verify_token


def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise unauthorized("未登录或登录已失效，请先登录")
    token = auth_header[len("Bearer "):].strip()
    try:
        payload = verify_token(token)
    except pyjwt.PyJWTError:
        raise unauthorized("登录已失效，请重新登录") from None

    if is_token_blacklisted(sha256_hex(token)):
        raise unauthorized("登录状态已退出，请重新登录")

    return {
        "id": payload.get("sub"),
        "username": payload.get("username"),
        "role": payload.get("role"),
    }


def require_roles(*roles: str):
    """工厂：生成"需要指定角色"的依赖。用法 Depends(require_roles('admin'))。"""

    def checker(user: dict = Depends(get_current_user)) -> dict:
        if not user.get("role") or user["role"] not in roles:
            raise forbidden("当前账号角色无权访问该接口")
        return user

    return checker
