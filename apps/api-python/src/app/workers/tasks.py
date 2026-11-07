"""RQ 任务：文档索引（对齐 ingestion.worker.ts 的处理器 + 失败状态收尾）。

失败状态机（全项目唯一写 PENDING(重试中)/ERROR(终局) 的地方）：
  - 还有重试机会 → 置回 PENDING + "（稍后自动重试）"；
  - 重试耗尽     → 置 ERROR + 原因；
  之后把异常继续向上抛，RQ 才会按 Retry 策略安排重试。

尝试次数用 job.meta.attempts 自行计数（不依赖 RQ 内部字段的语义差异，
与 BullMQ attempts=3 对齐：总尝试 3 次）。
"""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import update

import app.workers.queue as queue_mod
from app.core.redis_client import get_rq_redis
from app.db.models import Document
from app.db.session import SessionLocal
from app.services import ingestion_service

logger = logging.getLogger("mini-rag.worker")


def index_document(document_id: str) -> None:
    from rq import get_current_job

    job = None
    try:
        job = get_current_job(connection=get_rq_redis())
    except Exception:
        job = None

    try:
        with SessionLocal() as session:
            ingestion_service.process(session, document_id)
    except Exception as error:
        message = str(error) or type(error).__name__
        attempts = 1
        if job is not None:
            attempts = int(job.meta.get("attempts", 0)) + 1
            job.meta["attempts"] = attempts
            try:
                job.save()
            except Exception:
                pass
        will_retry = attempts < queue_mod.MAX_ATTEMPTS
        try:
            with SessionLocal() as session:
                session.execute(
                    update(Document)
                    .where(Document.id == document_id)
                    .values(
                        status="PENDING" if will_retry else "ERROR",
                        error_message=f"{message}（稍后自动重试）" if will_retry else message,
                        updated_at=datetime.utcnow(),
                    )
                )
                session.commit()
        except Exception as update_error:
            logger.error("更新失败状态时出错：%s", update_error)
        if will_retry:
            logger.warning("任务失败，将自动重试：index-%s（原因：%s）", document_id, message)
        else:
            logger.error("任务重试耗尽，最终失败：index-%s（原因：%s）", document_id, message)
        raise
