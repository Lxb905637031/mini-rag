"""RQ Worker 入口（文档索引消费者）。

对齐 ingestion.worker.ts 的三件事：
  1) 消费队列任务（串行，保护 Ollama）；
  2) 失败状态收尾（在 tasks.py 内实现：PENDING 重试中 / ERROR 终局）；
  3) 启动自愈 recover_orphans：把卡在 PENDING/PROCESSING 的历史文档重新入队
     （jobId 幂等去重，重复入队无副作用；process 本身幂等）。

用 SimpleWorker（同进程执行任务）：Node 版的 BullMQ Worker 也运行在 API 同进程，
语义一致；同时避免 fork 模式在受限运行环境（沙箱/容器）下子进程异常的问题。

运行：cd apps/api-python && uv run mini-rag-worker（或 uv run python -m app.workers）
"""

from __future__ import annotations

import logging
import os

import rq
from sqlalchemy import select

from app.core.redis_client import get_rq_redis
from app.db.models import Document
from app.db.session import SessionLocal
from app.workers.queue import QUEUE_NAME, enqueue_index

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("mini-rag.worker")


def recover_orphans() -> None:
    try:
        with SessionLocal() as session:
            stuck = list(
                session.scalars(
                    select(Document.id).where(
                        Document.status.in_(["PENDING", "PROCESSING"])
                    )
                )
            )
        if not stuck:
            return
        for document_id in stuck:
            enqueue_index(document_id)
        logger.info("启动自愈：已重新入队 %d 个未完成文档", len(stuck))
    except Exception as error:
        # 自愈失败只告警不阻断启动：任务可由下次重启再补。
        logger.error("启动自愈失败：%s", error)


def main() -> None:
    connection = get_rq_redis()
    recover_orphans()
    # 名字带 PID：进程崩溃后 Redis 里的旧注册（TTL 未到）不会阻塞重启。
    worker = rq.SimpleWorker(
        [QUEUE_NAME],
        connection=connection,
        name=f"mini-rag-ingestion-{os.getpid()}",
        default_worker_ttl=600,
        default_result_ttl=600,
    )
    logger.info("RQ worker 启动，监听队列：%s", QUEUE_NAME)
    worker.work()
