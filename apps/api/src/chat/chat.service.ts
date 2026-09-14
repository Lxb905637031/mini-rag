/**
 * @file apps/api/src/chat/chat.service.ts
 * @description 问答业务服务：把一次提问串成完整的 RAG 流程并返回答案与检索过程。
 *
 * 一次问答的数据流（重点理解）：
 *   1. 从 SQLite 查出知识库及其全部文档切片（chunks）。
 *   2. 准备两个“检索通道”：
 *      - 向量通道：ChromaStore（把问题转向量后做相似度检索）；
 *      - 关键词通道：Bm25Retriever（直接在内存中的切片文本上做 BM25 词面匹配，
 *        所以这里需要把数据库里的切片组装成它需要的形状）。
 *   3. RetrievalService 按所选模式（vector / bm25 / hybrid）编排，可选重排。
 *   4. RagApplication 拿到检索片段后调用本地大模型生成最终答案。
 *   5. 返回 { answer, trace }：trace 记录每一路检索结果与耗时，供前端/实验室调试。
 *
 * 小白导读：这些 RagApplication、RetrievalService 等都是“每次请求临时拼装”的普通对象
 * （不是 Nest 注入的单例），因为它们依赖“本次请求的知识库 id”。
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  Bm25Retriever, // BM25 关键词检索器
  ChromaStore, // Chroma 向量库封装
  createOllamaAnswerGenerator, // 创建“大模型答案生成器”
  createOllamaEmbeddings, // 创建“文本转向量”的嵌入模型客户端
  LexicalReranker, // 词面重排器
  loadConfig, // 读取环境变量配置
  RagApplication, // RAG 总编排：检索 + 生成
  RetrievalService, // 检索编排：向量/BM25/混合 + 重排
} from '@mini-rag/core'
import { PrismaService } from '../prisma/prisma.service.js'

@Injectable()
export class ChatService {
  // 服务实例化时读取一次配置（环境变量），整个生命周期复用。
  private readonly config = loadConfig()

  // 注入数据库服务。
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 执行一次问答。
   * @param input.knowledgeBaseId 在哪个知识库中检索
   * @param input.query          用户问题
   * @param input.mode           检索模式，缺省 hybrid（混合检索）
   * @param input.topK           最终取用片段数，缺省取配置文件的 topK
   * @param input.rerank         是否启用重排
   * @param ownerId              当前登录用户 id：只能在自己的知识库中提问
   * @returns RagApplication 的结果：{ answer 答案文本, trace 检索过程明细 }
   * @throws NotFoundException 知识库 id 不存在或不属于当前用户时返回 404
   */
  async query(
    input: {
      knowledgeBaseId: string
      query: string
      mode?: 'vector' | 'bm25' | 'hybrid'
      topK?: number
      rerank?: boolean
    },
    ownerId: string,
  ) {
    // 1) 查知识库（必须归属当前用户），并连带查出其下所有文档、每个文档的所有切片。
    // findFirst 的复合 where 同时限定 id 与归属人，防止拿别人的知识库 id 提问。
    const base = await this.prisma.knowledgeBase.findFirst({
      where: { id: input.knowledgeBaseId, ownerId },
      include: { documents: { include: { chunks: true } } },
    })
    // 找不到（id 非法或属于别人）统一抛 404，全局异常过滤器会转成统一错误响应。
    if (!base) throw new NotFoundException('Knowledge base not found')

    // 2) 创建嵌入模型客户端（负责把问题文本变成向量）。
    const embeddings = createOllamaEmbeddings(this.config)

    // 连接（必要时创建）该知识库专属的 Chroma collection。
    // 最后一个参数 knowledgeBaseId 用于在同一个 Chroma 中隔离不同知识库的数据。
    const store = await ChromaStore.create(
      embeddings,
      this.config.chromaCollection,
      this.config.chromaUrl,
      input.knowledgeBaseId,
    )

    // 文档 id → 数据库中当前正确的文件名。
    // 背景：Chroma 向量元数据里的 fileName 是“文档摄入那一刻”写入的，历史文档可能仍是
    // 旧的乱码名（SQLite 已修正但向量库里的副本不会自动更新），所以这里以数据库为唯一准绳。
    const fileNameByDocumentId = new Map(
      base.documents.map(document => [document.id, document.originalName]),
    )

    // 向量检索通道的薄包装：检索结果出来后，按 metadata.documentId 用数据库里的正确文件名
    // 覆盖 Chroma 带回的 fileName（可能是乱码）。这样 RRF 融合、重排、大模型引用 [S1]、
    // 前端“检索依据”卡片拿到的文件名全部是正常中文；查不到归属文档时原样返回，不误伤。
    const vectorSearch = {
      search: async (query: string, k: number) =>
        (await store.search(query, k)).map(item => {
          // Chroma 元数据里的 documentId 在摄入时由 Service 写入（见 ingestion.service.ts）。
          const fileName = fileNameByDocumentId.get(String(item.metadata.documentId))
          return fileName ? { ...item, metadata: { ...item.metadata, fileName } } : item
        }),
    }

    // 3) 把数据库里的切片拍平（flatMap）成 BM25 检索器需要的 { pageContent, metadata } 结构。
    const chunks = base.documents.flatMap(document =>
      document.chunks.map(chunk => {
        // 入库时存下的元数据（来源文件、页码等）可能为空，做一次兜底。
        const metadata = (chunk.metadata as Record<string, unknown>) ?? {}
        return {
          pageContent: chunk.content, // 切片正文
          metadata: {
            ...metadata, // 保留入库时的原始元数据
            // 统一补上 chunkId：优先用元数据里已有的，没有就退回数据库主键。
            chunkId: String(metadata.chunkId ?? chunk.id),
            documentId: chunk.documentId, // 属于哪个文档
            fileName: document.originalName, // 冗余带上文件名，方便生成引用来源
          },
        } as any
      }),
    )

    // 4) 组装检索服务：向量通道（带文件名修正的包装）+ BM25 通道 + 重排器。
    // RetrievalService 只要求向量通道实现 search 方法（结构化类型），vectorSearch 形状天然兼容。
    const retrieval = new RetrievalService(
      vectorSearch,
      new Bm25Retriever(chunks),
      new LexicalReranker(),
    )
    // 组装 RAG 应用：检索服务 + 答案生成器（Ollama 本地大模型，temperature=0）。
    const app = new RagApplication(retrieval, createOllamaAnswerGenerator(this.config))

    // 5) 执行问答；参数缺省时：混合检索、配置文件中的 topK。
    const result = await app.answerQuestion({
      query: input.query,
      mode: input.mode ?? 'hybrid',
      topK: input.topK ?? this.config.topK,
      rerank: input.rerank,
    })
    return result
  }
}
