"""RQ 任务队列：平替 BullMQ 的文档索引队列（语义对齐点见各注释）。

Node 版 (ingestion.queue.ts / ingestion.worker.ts) 的关键语义：
  - attempts=3（首次 + 2 次重试）、指数退避起步 3s；
  - jobId = "index-<文档id>" 幂等去重：重复入队静默忽略；
  - removeOnComplete 10 分钟 / removeOnFail 1 天；
  - 串行消费（concurrency 1）保护 Ollama；
  - worker 启动时把 PENDING/PROCESSING 的历史文档重新入队（启动自愈）。
"""

from __future__ import annotations

import logging

import rq
from rq import Retry, job

from app.core.redis_client import get_rq_redis

QUEUE_NAME = "ingestion"

# 总尝试次数 3 次（对齐 BullMQ attempts=3）：max=2 表示"首次 + 2 次重试"，
# 重试间隔 3s、6s（等价指数退避起步 3000ms）。
MAX_ATTEMPTS = 3
_RETRY = Retry(max=MAX_ATTEMPTS - 1, interval=[3, 6])
_JOB_TIMEOUT = 10 * 60  # 对齐 BullMQ lockDuration 10 分钟（慢 PDF + 逐块 embedding）
_RESULT_TTL = 600  # 对齐 removeOnComplete.age = 600s
_FAILURE_TTL = 24 * 60 * 60  # 对齐 removeOnFail.age = 1 天

logger = logging.getLogger("mini-rag.queue")


def ingestion_job_id(document_id: str) -> str:
    return f"index-{document_id}"


def get_queue() -> rq.Queue:
    return rq.Queue(QUEUE_NAME, connection=get_rq_redis(), default_timeout=_JOB_TIMEOUT)


def enqueue_index(document_id: str) -> job.Job | None:
    """把"索引文档"任务入队；同 id 存活任务会被静默忽略（幂等去重）。"""
    queue = get_queue()
    job_id = ingestion_job_id(document_id)
    try:
        existing = queue.fetch_job(job_id)
    except Exception:
        existing = None
    if existing is not None:
        try:
            status = existing.get_status()
        except Exception:
            status = None
        # 还在排队/执行/等待重试的任务：忽略重复入队（对齐 BullMQ jobId 去重）。
        if status in (rq.job.JobStatus.QUEUED, rq.job.JobStatus.STARTED,
                      rq.job.JobStatus.DEFERRED, rq.job.JobStatus.SCHEDULED):
            return existing
        # 已完成/已失败的旧任务：删掉后重新入队，让同 id 可复用。
        try:
            existing.delete()
        except Exception:
            pass
    return queue.enqueue(
        "app.workers.tasks.index_document",
        args=(document_id,),
        job_id=job_id,
        retry=_RETRY,
        job_timeout=_JOB_TIMEOUT,
        result_ttl=_RESULT_TTL,
        failure_ttl=_FAILURE_TTL,
    )


def remove_queued_job(document_id: str) -> None:
    """删除还在队列里的索引任务（删除文档时顺手清理）；任何失败都静默忽略。"""
    try:
        job_obj = get_queue().fetch_job(ingestion_job_id(document_id))
        if job_obj is not None:
            job_obj.delete()
    except Exception as error:
        logger.warning("删除排队任务失败（忽略）：%s", error)


def queue_counts() -> dict | None:
    """队列实时统计（健康检查用）：waiting/active/delayed/failed；Redis 不可用时返回 None。"""
    try:
        from rq.registry import FailedJobRegistry, ScheduledJobRegistry, StartedJobRegistry

        connection = get_rq_redis()
        queue = get_queue()
        return {
            "waiting": queue.count,
            "active": StartedJobRegistry(QUEUE_NAME, connection=connection).count,
            "delayed": ScheduledJobRegistry(QUEUE_NAME, connection=connection).count,
            "failed": FailedJobRegistry(QUEUE_NAME, connection=connection).count,
        }
    except Exception:
        return None
