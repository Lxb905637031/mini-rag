"""Redis 客户端：JWT 黑名单（业务键 auth:blacklist:<sha256>）+ RQ 队列共用连接。"""

from __future__ import annotations

from functools import lru_cache

import redis as redis_lib

from app.core.config import get_settings

BLACKLIST_PREFIX = "auth:blacklist"


def blacklist_key(token_hash: str) -> str:
    return f"{BLACKLIST_PREFIX}:{token_hash}"


@lru_cache
def get_redis() -> redis_lib.Redis:
    """业务连接（JWT 黑名单等）：字符串键，按文本解码。"""
    return redis_lib.Redis.from_url(get_settings().redis_url, decode_responses=True)


@lru_cache
def get_rq_redis() -> redis_lib.Redis:
    """RQ 队列专用连接：任务载荷是 pickle 二进制，必须保持二进制解码
    （对齐 Node 版 RedisService 与 BullMQ 各自一条连接的结构）。"""
    return redis_lib.Redis.from_url(get_settings().redis_url, decode_responses=False)


def blacklist_token(token_hash: str, ttl_seconds: int) -> None:
    get_redis().set(blacklist_key(token_hash), "1", ex=ttl_seconds)


def is_token_blacklisted(token_hash: str) -> bool:
    return bool(get_redis().exists(blacklist_key(token_hash)))
