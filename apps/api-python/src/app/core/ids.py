"""ID 生成：cuid 风格的主键（c + 36 进制毫秒时间戳 + 随机串）。

表结构沿用 Prisma 迁移（id TEXT 主键、默认值由应用生成），新记录的 id
由这里生成即可，与旧数据无需任何换算。
"""

from __future__ import annotations

import secrets
import time

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


def _to_base36(value: int) -> str:
    if value == 0:
        return "0"
    digits = []
    while value:
        value, rem = divmod(value, 36)
        digits.append(_ALPHABET[rem])
    return "".join(reversed(digits))


def new_id(prefix: str = "c") -> str:
    timestamp_ms = time.time_ns() // 1_000_000
    random_part = "".join(secrets.choice(_ALPHABET) for _ in range(18))
    return f"{prefix}{_to_base36(timestamp_ms)}{random_part}"
