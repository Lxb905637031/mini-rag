/**
 * @file packages/rag-core/src/vectorstore/chroma-store.ts
 * @description 向量数据库 Chroma 的薄封装：对外提供“写入文档块 / 相似度检索 / 按 id 删除”三件事。
 *
 * 小白导读：
 * - Chroma 是一个专门存向量的数据库（本项目以独立 HTTP 服务运行，默认 8000 端口）。
 * - collection（集合）可以类比成关系数据库里的“表”：所有文档块的向量和原文都存在某个 collection 中，
 *   本项目默认集合名 mini_rag_documents（见 config.ts 的 chromaCollection）。
 * - where 过滤：检索时除了“比向量距离”，还可以附带元数据过滤条件。本文件用
 *   { knowledgeBaseId } 作为 where 条件，保证只在指定知识库的文档块里搜索，不串库。
 * - distance（距离）与 score（分数）：Chroma 返回的是距离，距离越小越相似（0 表示完全相同）；
 *   而业务侧习惯“分数越大越相关”，所以本文件用 1 / (1 + distance) 把距离换算成 0~1 之间的分数。
 *
 * 在链路中的位置：
 * - 上游：embeddings 负责把文本转向量；ingestion（摄入）调用 addDocuments 把块连同向量写入 Chroma；
 * - 下游：retrieval-service 把本类当作 VectorSearcher，调用 search 取回语义最相近的块，
 *   再与 BM25 结果做 RRF 融合、可选 rerank，最后交给 answer-generator 生成答案。
 *
 * 异常与降级：本文件不做任何重试或兜底。Chroma 服务连不上、collection 不存在等错误会由
 * LangChain 的 Chroma 客户端直接向上抛出；addDocuments 失败则该批块未入库，search 失败则整个问答失败。
 */
import { Chroma } from '@langchain/community/vectorstores/chroma'
import type { Embeddings } from '@langchain/core/embeddings'
import type { Document } from '@langchain/core/documents'
import type { SearchResult } from '../types.js'

/**
 * Chroma 向量库的业务封装类。
 *
 * 一个实例对应“一个 collection + 可选的一个知识库过滤条件”，
 * 内部把 LangChain 的 Chroma 客户端组合进来（组合优于继承，方便以后换向量库实现）。
 */
export class ChromaStore {
  /**
   * 构造函数通常不直接调用，请使用静态方法 {@link ChromaStore.create} 异步创建。
   *
   * @param store LangChain 的 Chroma 客户端，已绑定 collection 与服务地址
   * @param knowledgeBaseId 知识库 id；传入后所有检索都会带上该 where 过滤；不传则跨全部知识库检索
   */
  constructor(
    // readonly 表示该属性只在构造时赋值，之后不可重新指向，避免运行中被意外替换。
    private readonly store: Chroma,
    private readonly knowledgeBaseId?: string,
  ) {}

  static async create(
    embeddings: Embeddings,
    collectionName: string,
    url: string,
    knowledgeBaseId?: string,
  ): Promise<ChromaStore> {
    const store = new Chroma(embeddings, { collectionName, url })
    return new ChromaStore(store, knowledgeBaseId)
  }

  async addDocuments(documents: Document[]): Promise<void> {
    await this.store.addDocuments(documents, {
      ids: documents.map(document => String(document.metadata.chunkId)),
    })
  }
  async search(query: string, k: number): Promise<SearchResult[]> {
    const results = await this.store.similaritySearchWithScore(
      query,
      k,
      this.knowledgeBaseId ? { knowledgeBaseId: this.knowledgeBaseId } : undefined,
    )
    return results.map(([document, distance], index) => ({
      id: String(document.metadata.chunkId ?? index),
      pageContent: document.pageContent,
      score: 1 / (1 + distance),
      metadata: { ...document.metadata, distance },
    }))
  }
  async deleteIds(ids: string[]): Promise<void> {
    if (ids.length) await this.store.delete({ ids })
  }
}
