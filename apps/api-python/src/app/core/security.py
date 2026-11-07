"""密码哈希与 JWT：与 Node 版 (bcryptjs + @nestjs/jwt) 完全兼容。

- bcrypt：$2a$/$2b$ 哈希互相兼容，Node 版建的账号可直接登录；cost 同为 10；
- JWT：HS256 + 相同 secret，Node 版签发的旧令牌可直接验签；
  载荷 {sub, username, role}，过期时间解析规则对齐 jsonwebtoken 的 ms 字符串（1d/12h/30m/10s/5000ms）。
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import get_settings

_UNIT_MS = {
    "ms": 1,
    "s": 1_000,
    "m": 60_000,
    "h": 3_600_000,
    "d": 86_400_000,
    "w": 604_800_000,
}


def parse_duration_seconds(value: str | int) -> int:
    """把 JWT_EXPIRES_IN 解析成秒：'1d'→86400；纯数字按毫秒（对齐 ms/jsonwebtoken）。"""
    if isinstance(value, int):
        return value
    matched = re.fullmatch(r"(\d+)\s*(ms|s|m|h|d|w)?", value.strip(), flags=re.IGNORECASE)
    if not matched:
        return 3_600  # 解析失败按 1h 兜底，与 Node 版默认值一致
    number, unit = matched.groups()
    unit = (unit or "ms").lower()
    return int(number) * _UNIT_MS[unit] // 1_000


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def sign_token(payload: dict) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires_in = parse_duration_seconds(settings.jwt_expires_in)
    body = {
        **payload,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    return jwt.encode(body, settings.jwt_secret, algorithm="HS256")


def verify_token(token: str) -> dict:
    """验签 + 过期校验。失败抛 jwt.PyJWTError（调用方转成 401）。"""
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


def decode_token_unverified(token: str) -> dict | None:
    """只解析不验签（登出时读取 exp 用，能走到登出说明守卫已验签通过）。"""
    try:
        return jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return None


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
