/**
 * @file packages/rag-core/src/rag.ts
 * @description RAG 应用的总编排入口：把“检索”与“生成”两步串成一次完整问答。
 *
 * 在整个 RAG 链路中的位置（最末端）：
 *   用户问题
 *     → RetrievalService.search() 取回最相关的若干片段（并产出 trace 调试信息）
 *     → AnswerGenerator.answer() 把问题 + 片段拼成 prompt，交给大模型生成答案
 *     → 返回 { answer, trace }
 *
 * 本类不关心检索和生成的具体实现（只依赖它们的接口/类型），方便替换内部组件。
 */
import type { AnswerGenerator } from './generation/answer-generator.js'
import type { ChunkStrategy, RetrievalMode, RetrievalTrace } from './types.js'
import type { RetrievalService } from './retrieval/retrieval-service.js'

export class RagApplication {
  /**
   * @param retrieval 检索服务（向量/BM25/混合 + 可选重排）
   * @param generator 答案生成器（通常背后是 Ollama 本地大模型）
   */
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly generator: AnswerGenerator,
  ) {}

  /**
   * 回答一个问题。
   * @param input.query 原始问题（不能为空串）
   * @param input.mode 检索模式：vector 纯向量 / bm25 纯关键词 / hybrid 混合
   * @param input.topK 最终取多少个片段喂给大模型
   * @param input.rerank 是否对初筛结果再重排
   * @param input.chunkStrategy 预留字段（当前检索阶段未使用）
   * @returns answer 生成的答案文本；trace 本次检索的完整过程（各路结果与耗时），用于前端调试展示
   * @throws Error 问题为空白时抛出
   */
  async answerQuestion(input: {
    query: string
    mode: RetrievalMode
    topK: number
    rerank?: boolean
    chunkStrategy?: ChunkStrategy
  }): Promise<{ answer: string; trace: RetrievalTrace }> {
    // 入参防御：空白问题没有检索意义，直接报错。
    if (!input.query.trim()) throw new Error('Query cannot be empty')
    // 第一步：检索。trim 去掉首尾空白，避免无意义字符影响分词与向量。
    const trace = await this.retrieval.search(
      input.query.trim(),
      input.mode,
      input.topK,
      input.rerank,
    )
    // 第二步：用重排后的片段（trace.reranked）作为上下文生成答案。
    const generated = await this.generator.answer(input.query.trim(), trace.reranked)
    // 同时返回答案与检索轨迹：答案给用户看，trace 给“检索实验室/调试面板”看。
    return { answer: generated.answer, trace }
  }
}
