"""文档加载器：把磁盘文件解析成统一的 { pageContent, metadata } 列表。

移植自 rag-core/loaders/document-loader.ts：
  - 白名单 .pdf/.doc/.docx/.txt/.md/.markdown；
  - PDF 按页解析并记录 metadata.page（pypdf 等价 PDFLoader(splitPages: true)）；
  - .docx 用 python-docx（等价 mammoth/DocxLoader，无需缺包降级分支）；
  - .doc 调 macOS textutil（与 Node 版一致，仅 macOS 可用）；
  - 空文本抛错 "The document contains no readable text"；
  - 统一补 metadata.source / fileName。
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from pypdf import PdfReader

SUPPORTED_EXTENSIONS = {".pdf", ".doc", ".docx", ".txt", ".md", ".markdown"}


def load_document(file_path: str) -> list[dict]:
    path = Path(file_path)
    extension = path.suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported document type: {extension}")

    if extension == ".pdf":
        documents = _load_pdf(str(path))
    elif extension == ".docx":
        documents = [_load_docx(str(path))]
    elif extension == ".doc":
        documents = [{"pageContent": _load_doc(str(path)), "metadata": {}}]
    else:
        # .txt / .md / .markdown 本身就是文本；errors='replace' 对齐 Node utf8 解码容错。
        documents = [
            {"pageContent": path.read_text(encoding="utf-8", errors="replace"), "metadata": {}}
        ]

    if not documents or all(not str(doc["pageContent"]).strip() for doc in documents):
        raise ValueError("The document contains no readable text")

    file_name = path.name
    for document in documents:
        metadata = dict(document.get("metadata") or {})
        metadata["source"] = file_path
        metadata["fileName"] = file_name
        document["metadata"] = metadata
    return documents


def _load_pdf(file_path: str) -> list[dict]:
    reader = PdfReader(file_path)
    pages = []
    for number, page in enumerate(reader.pages, start=1):
        pages.append(
            {
                "pageContent": page.extract_text() or "",
                "metadata": {"page": number},
            }
        )
    return pages


def _load_docx(file_path: str) -> dict:
    import docx

    document = docx.Document(file_path)
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    return {"pageContent": text, "metadata": {}}


def _load_doc(file_path: str) -> str:
    result = subprocess.run(
        ["textutil", "-convert", "txt", "-stdout", file_path],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout
