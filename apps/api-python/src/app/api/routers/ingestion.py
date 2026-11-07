"""文档摄入路由（对齐 ingestion.controller.ts）：

  POST   /knowledge-bases/:knowledgeBaseId/documents                     上传（multipart 字段 file）
  GET    /knowledge-bases/:knowledgeBaseId/documents                     文档列表
  GET    /knowledge-bases/:knowledgeBaseId/documents/:documentId/chunks  切片预览
  DELETE /knowledge-bases/:knowledgeBaseId/documents/:documentId         删除（连带清理向量）

上传约束与 Node 版一致：10MB 上限、后缀白名单 pdf/doc/docx/txt/md/markdown，
无文件或后缀不合法 → 400 同一句英文提示。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.errors import bad_request, payload_too_large
from app.db.session import get_db
from app.services import ingestion_service
from app.services.ingestion_service import MAX_UPLOAD_BYTES, UPLOAD_NAME_RE

router = APIRouter(
    prefix="/knowledge-bases/{knowledge_base_id}/documents",
    tags=["ingestion"],
)


@router.post("")
def upload(
    knowledge_base_id: str,
    user: dict = Depends(get_current_user),
    session: Session = Depends(get_db),
    file: UploadFile | None = File(default=None),
) -> dict:
    if file is None or not file.filename or not UPLOAD_NAME_RE.search(file.filename):
        raise bad_request("Only PDF, DOC, DOCX, TXT and Markdown files are supported")
    content = file.file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise payload_too_large("File too large")
    return ingestion_service.upload(
        session,
        knowledge_base_id,
        file.filename,
        file.content_type or "application/octet-stream",
        content,
        user["id"],
    )


@router.get("")
def list_documents(knowledge_base_id: str, user: dict = Depends(get_current_user),
                   session: Session = Depends(get_db)) -> list[dict]:
    return ingestion_service.list_documents(session, knowledge_base_id, user["id"])


@router.get("/{document_id}/chunks")
def list_chunks(document_id: str, user: dict = Depends(get_current_user),
                session: Session = Depends(get_db)) -> list[dict]:
    return ingestion_service.list_chunks(session, document_id, user["id"])


@router.delete("/{document_id}")
def remove_document(document_id: str, user: dict = Depends(get_current_user),
                    session: Session = Depends(get_db)) -> dict:
    return ingestion_service.remove_document(session, document_id, user["id"])
