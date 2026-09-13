/**
 * @file packages/rag-core/src/index.ts
 * @description 核心库的“统一出口”（barrel file / 桶文件）。
 *
 * 小白导读：外部使用方（如 apps/api）不需要记住每个模块的深层路径，
 * 只要 `import { xxx } from '@mini-rag/core'`，就会从本文件拿到所有公开能力。
 * 这里用 `export *` 把各模块的导出“原样转发”，本身不写任何业务逻辑。
 */
// 全库共用的类型定义（RagConfig、SearchResult、RetrievalMode 等）
export * from './types.js'
// 环境变量配置读取
export * from './config.js'
// 文档切块
export * from './chunking/chunking.js'
// 文档加载与解析（PDF / Word / TXT / Markdown）
export * from './loaders/document-loader.js'
// 调用本地 Ollama 的嵌入模型，把文本转向量
export * from './embeddings/ollama-embeddings.js'
// Chroma 向量库封装（写入 / 删除 / 相似度检索）
export * from './vectorstore/chroma-store.js'
// BM25 关键词检索
export * from './retrieval/bm25-retriever.js'
// 倒数排名融合（RRF）：合并向量与 BM25 两路结果
export * from './retrieval/rrf.js'
// 检索编排：按 vector / bm25 / hybrid 模式组织整条检索链路
export * from './retrieval/retrieval-service.js'
// 词面重排器
export * from './reranking/reranker.js'
// 调用 Ollama 大模型生成答案（含 prompt 拼装）
export * from './generation/answer-generator.js'
// RAG 应用编排入口（检索 + 生成一条龙）
export * from './rag.js'
