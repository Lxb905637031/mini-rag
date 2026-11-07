"""知识库路由（对齐 knowledge.controller.ts）：

  GET    /knowledge-bases        列表（带文档计数，按更新时间倒序）
  POST   /knowledge-bases        新建
  GET    /knowledge-bases/:id    详情（含文档清单）
  DELETE /knowledge-bases/:id    删除
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.schemas import CreateKnowledgeBaseDto
from app.services import knowledge_service

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge"])


@router.get("")
def list_bases(user: dict = Depends(get_current_user),
               session: Session = Depends(get_db)) -> list[dict]:
    return knowledge_service.list_bases(session, user["id"])


@router.post("")
def create_base(body: CreateKnowledgeBaseDto, user: dict = Depends(get_current_user),
                session: Session = Depends(get_db)) -> dict:
    return knowledge_service.create_base(session, body.name, user["id"])


@router.get("/{base_id}")
def get_base(base_id: str, user: dict = Depends(get_current_user),
             session: Session = Depends(get_db)) -> dict:
    return knowledge_service.get_base(session, base_id, user["id"])


@router.delete("/{base_id}")
def remove_base(base_id: str, user: dict = Depends(get_current_user),
                session: Session = Depends(get_db)) -> dict:
    return knowledge_service.remove_base(session, base_id, user["id"])
