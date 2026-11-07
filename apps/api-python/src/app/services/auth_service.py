"""认证业务：移植 apps/api/src/auth/auth.service.ts。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import conflict, unauthorized
from app.core.ids import new_id
from app.core.redis_client import blacklist_token
from app.core.security import (decode_token_unverified, hash_password, sign_token,
                                sha256_hex, verify_password)
from app.db.models import KnowledgeBase, User, utcnow
from app.services.serializers import safe_user


def _token_for(user: User, role: str) -> str:
    return sign_token({"sub": user.id, "username": user.username, "role": role})


def login(session: Session, username: str, password: str) -> dict:
    user = session.scalar(select(User).where(User.username == username))
    # 用户不存在或密码错误统一提示，避免暴露"用户名是否存在"。
    if user is None or not verify_password(password, user.password_hash):
        raise unauthorized("用户名或密码错误")
    # DB 存大写枚举 ADMIN/USER，签进 JWT 的是小写（与 Node 版映射一致）。
    token = _token_for(user, "admin" if user.role == "ADMIN" else "user")
    return {"accessToken": token, "user": safe_user(user)}


def register(session: Session, username: str, password: str, display_name: str | None) -> dict:
    if session.scalar(select(User).where(User.username == username)) is not None:
        raise conflict("用户名已被占用")

    now = utcnow()
    user = User(
        id=new_id(),
        username=username,
        password_hash=hash_password(password),
        display_name=(display_name or "").strip() or None,
        role="USER",
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    # 同一事务内先落用户行：保证下面"默认知识库"的外键（ownerId → User.id）有主。
    session.flush()
    # 注册即自动创建"默认知识库"：保证新用户登录后上传区直接可用。
    session.add(
        KnowledgeBase(id=new_id(), name="默认知识库", owner_id=user.id,
                      created_at=now, updated_at=now)
    )
    session.commit()
    session.refresh(user)
    token = _token_for(user, "user")
    return {"accessToken": token, "user": safe_user(user)}


def profile(session: Session, user_id: str) -> dict:
    user = session.get(User, user_id)
    if user is None:
        raise unauthorized("用户不存在，请重新登录")
    return safe_user(user)


def logout(token: str) -> dict:
    decoded = decode_token_unverified(token)
    exp = (decoded or {}).get("exp")
    ttl_seconds = exp - int(utcnow().timestamp()) if exp else 0
    # 令牌本身已过期就无需拉黑；TTL 与令牌剩余寿命一致，到期自动清理。
    if ttl_seconds > 0:
        blacklist_token(sha256_hex(token), ttl_seconds)
    return {"success": True}
