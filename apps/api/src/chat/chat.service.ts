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
   * @returns RagApplication 的结果：{ answer 答案文本, trace 检索过程明细 }
   * @throws NotFoundException 知识库 id 不存在时返回 404
   */
  async query(input: {
    knowledgeBaseId: string
    query: string
    mode?: 'vector' | 'bm25' | 'hybrid'
    topK?: number
    rerank?: boolean
  }) {
    // 1) 查知识库，并连带查出其下所有文档、每个文档的所有切片（两层 include 嵌套）。
    const base = await this.prisma.knowledgeBase.findUnique({
      where: { id: input.knowledgeBaseId },
      include: { documents: { include: { chunks: true } } },
    })
    // 找不到知识库直接抛 404，全局异常过滤器会把它转成统一错误响应。
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

    // 4) 组装检索服务：向量通道 + BM25 通道 + 重排器。
    const retrieval = new RetrievalService(store, new Bm25Retriever(chunks), new LexicalReranker())
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
