"""数据库会话：复用 Node/Prisma 版已有的 PostgreSQL 实例（表结构不动）。"""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()


def _normalize_url(url: str) -> str:
    """剥掉 Prisma 专用连接参数（如 ?schema=public），psycopg 不认识它们。

    .env 与 Node 版共用同一份 DATABASE_URL，这里在 Python 侧做兼容清洗。
    """
    parts = urlparse(url)
    query = [(key, value) for key, value in parse_qsl(parts.query) if key != "schema"]
    return urlunparse(parts._replace(query=urlencode(query)))


engine = create_engine(
    _normalize_url(settings.database_url),
    pool_pre_ping=True,
    pool_size=8,
    max_overflow=8,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db():
    """FastAPI 依赖：每个请求一个会话，请求结束自动关闭。"""
    session: Session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
