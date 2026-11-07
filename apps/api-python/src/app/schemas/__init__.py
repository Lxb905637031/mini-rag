"""请求体 DTO（Pydantic）：按领域拆分，统一从这里导出。

extra='ignore' 等价 ValidationPipe({whitelist: true})——多余字段直接剥离。
"""

from app.schemas.auth import LoginDto, RegisterDto
from app.schemas.chat import ChatQueryDto
from app.schemas.knowledge_base import CreateKnowledgeBaseDto
from app.schemas.lab import LabChunkDto

__all__ = [
    "LoginDto",
    "RegisterDto",
    "CreateKnowledgeBaseDto",
    "ChatQueryDto",
    "LabChunkDto",
]
