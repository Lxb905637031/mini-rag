# Mini RAG

一个用于学习和复盘的本地 RAG Web 系统：React + Vite 前端、Nest.js 后端、LangChain.js 核心、Ollama 模型、Chroma 向量库和 SQLite 元数据。

## 1. 术语先搞懂

- **RAG**：先检索资料，再把资料放进 Prompt，让模型依据资料回答。资料更新不需要重新训练模型。
- **Embedding**：把文本变成向量；语义相近的文本在向量空间距离更近。
- **Chroma**：专门保存向量并做相似度搜索的服务。本项目通过 Docker 启动它。
- **Docker**：把 Chroma 和它的运行环境封装成容器，避免手动安装服务；`docker compose up -d` 会在后台启动它。
- **Ollama**：本地模型运行器。聊天模型和 Embedding 模型都在本机运行，不需要 OpenAI API Key。
- **SQLite**：一个本地 `.db` 文件，保存知识库、文件状态和切片元数据，不需要单独启动数据库服务器。
- **LangChain.js**：把 Loader、切分器、Embedding、Retriever、Prompt 和 Chat Model 串起来的应用框架。

## 2. 环境准备

要求：Node.js 20+、pnpm、Docker Desktop、Ollama。

```bash
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
ollama pull llama3.2:3b
ollama pull nomic-embed-text
docker compose up -d
pnpm --filter api prisma:generate
pnpm --filter api prisma:migrate
```

如果只执行 Prisma 命令，至少需要先在 `apps/api/.env` 中配置 `DATABASE_URL="file:./dev.db"`。Prisma 会从执行目录加载这个文件。

启动开发服务：

```bash
pnpm dev
```

打开 <http://localhost:5173>。先在“知识库”页创建知识库并上传 PDF、DOCX、TXT 或 Markdown，再去“对话问答”页提问。

## 3. 系统闭环

```text
React 上传
  → Nest.js multipart API
  → PDF/DOCX/TXT/MD Loader
  → 分块
  → Ollama Embedding
  → Chroma (HNSW)
  → 向量/BM25 检索
  → RRF 融合
  → Rerank
  → Ollama ChatModel
  → 答案 + 来源 + 检索轨迹
```

## 4. 为什么这样做

把 `rag-core` 从 Nest.js 中独立出来，是为了让检索算法可以被 CLI、HTTP API 或测试复用。SQLite 只保存业务元数据，Chroma 只保存向量和检索所需 metadata；两者职责分开，删除文档时可以验证是否清理了两边数据。

MVP 使用 Chroma 默认的 HNSW。Flat 是逐条精确比较，适合评测基线；IVF 通过聚类分桶减少搜索范围；IVF-PQ 再压缩向量以节省内存，但会损失距离精度。不同数据库对这些索引的支持方式不同，所以项目真实运行 HNSW，同时在“检索实验室”解释其余选型。

## 5. 复习重点

- 固定大小分块容易实现，但可能切断语义。
- 递归字符分块优先段落和句子，是本项目默认策略。
- 语义分块根据相邻句向量相似度断开，效果依赖 Embedding 和阈值。
- 结构感知分块保留 Markdown 标题、PDF 页码和 Word 段落信息，方便引用。
- BM25 擅长专有名词、编号和精确关键词；向量检索擅长语义表达。
- RRF 使用 `weight / (60 + rank)`，只融合排名，不直接相加不同检索器的分数。
- Rerank 先扩大召回，再用更强模型精排，准确率提高但延迟和成本上升。

## 6. 风险与扩展

扫描型 PDF 没有文本层时需要 OCR；复杂表格和 Word 布局可能丢失结构。文档重建索引前要删除旧向量，否则会出现重复或过期答案。文档内容属于不可信数据，Prompt 已加入提示词注入防护，但仍应人工核验引用。

下一步可以增加流式输出、Redis/BullMQ 队列、bge-reranker、PostgreSQL/Qdrant、登录权限、评测集、混合搜索字段权重和生产部署。
