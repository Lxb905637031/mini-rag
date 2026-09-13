/**
 * @file packages/rag-core/src/retrieval/retrieval-service.ts
 * @description 检索编排器：按所选模式组织“向量检索 / BM25 / 混合融合 / 重排”整条链路，
 *              并产出包含中间结果的 RetrievalTrace（供调试面板展示每一步发生了什么）。
 *
 * 一次 search 的流程：
 *   1. 按模式分别取向量路、BM25 路的候选（每路取 k*2 条，给后续融合/重排留余量）；
 *   2. hybrid 模式用 RRF 把两路融合（权重 0.7 / 0.3，更偏向量）；单路模式直接用那一路；
 *   3. 若融合结果为空（例如向量库暂时没数据），兜底合并两路原始结果；
 *   4. 可选重排；最终只保留前 k 条；
 *   5. 连同各路原始结果与耗时一起放进 trace 返回。
 */
import type { SearchResult, RetrievalMode, RetrievalTrace } from '../types.js'
import { Bm25Retriever } from './bm25-retriever.js'
import { reciprocalRankFusion } from './rrf.js'
import type { Reranker } from '../types.js'

/** 向量检索通道的最小接口；ChromaStore 正好实现了它（面向接口编程，方便 mock 测试）。 */
export interface VectorSearcher {
  search(query: string, k: number): Promise<SearchResult[]>
}

export class RetrievalService {
  /**
   * @param vector 向量检索通道（如 ChromaStore）
   * @param bm25 关键词检索通道（内存 BM25）
   * @param reranker 重排器
   */
  constructor(
    private readonly vector: VectorSearcher,
    private readonly bm25: Bm25Retriever,
    private readonly reranker: Reranker,
  ) {}

  /**
   * 执行检索。
   * @param query 用户问题
   * @param mode vector=只走向量；bm25=只走关键词；hybrid=两者 RRF 融合
   * @param k 最终需要的结果条数
   * @param useRerank 是否在融合后再做一次重排，默认 false
   * @returns RetrievalTrace：最终结果在 reranked 字段（已截取前 k 条），
   *          其余字段是各路中间结果与总耗时，供前端“检索实验室”调试验证
   */
  async search(
    query: string,
    mode: RetrievalMode,
    k: number,
    useRerank = false,
  ): Promise<RetrievalTrace> {
    const started = Date.now()
    // 向量路：bm25 模式下完全跳过；否则取 k*2 条候选（召回从宽，后面再精选）。
    const vector = mode === 'bm25' ? [] : await this.vector.search(query, k * 2)
    // BM25 路：vector 模式下跳过。
    const bm25 = mode === 'vector' ? [] : this.bm25.search(query, k * 2)
    // 按模式决定“融合后候选”：hybrid 走 RRF；单路模式直接采用对应一路。
    const fused =
      mode === 'hybrid'
        ? reciprocalRankFusion([vector, bm25], [0.7, 0.3])
        : mode === 'vector'
          ? vector
          : bm25
    // 兜底：理论上 hybrid 应有融合结果；若为空（两路都没召回/数据异常），
    // 就把两路原始结果直接合并，避免返回空数组。统一截取前 k*2 条作为重排/返回基数。
    const base = (fused.length ? fused : [...vector, ...bm25]).slice(0, k * 2)
    // 可选重排：对候选做二次精细排序；不开启则原样使用。
    const reranked = useRerank ? await this.reranker.rerank(query, base) : base
    return {
      mode,
      vector, // 向量路原始结果（调试用）
      bm25, // BM25 路原始结果（调试用）
      fused, // 融合后的结果（调试用）
      reranked: reranked.slice(0, k), // 最终给大模型/用户的前 k 条
      durationMs: Date.now() - started, // 整条检索链路耗时
    }
  }
}
