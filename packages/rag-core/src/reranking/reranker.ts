/**
 * @file packages/rag-core/src/reranking/reranker.ts
 * @description 轻量级“词面重排器”（Lexical Reranker）。
 *
 * 小白导读——为什么检索之后还要“重排”：
 * - 初筛（向量检索 / BM25）一次会取回较多候选块（如 topK 的 2 倍），速度优先，排序不一定最贴合问题。
 * - 重排是对这批候选做第二次、更精细的打分排序，只保留最相关的几个喂给大模型。
 * - 本实现不依赖额外模型，而是用一个简单可解释的规则打分：
 *   候选块正文里每命中一个查询词加 1 分（词面重合度），再叠加初筛分数的 1% 作为微弱保底，
 *   这样在词面重合相同时，仍倾向于初筛认为更相似的块。
 */
import type { Reranker, SearchResult } from '../types.js'

/**
 * 基于查询词命中数的重排器，实现 types.ts 中定义的 Reranker 接口。
 */
export class LexicalReranker implements Reranker {
  /**
   * 对候选块重新打分并降序排列。
   *
   * @param query 用户的原始问题
   * @param candidates 初筛阶段取回的候选块数组（数量通常大于最终 topK）
   * @returns 重排后的新数组（不修改原数组），分数越高越靠前
   */
  async rerank(query: string, candidates: SearchResult[]): Promise<SearchResult[]> {
    // 把问题转小写并按空白切成词表；toLowerCase 让匹配大小写不敏感，filter(Boolean) 去掉空串。
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

    return (
      candidates
        .map(candidate => ({
          // 展开原块的所有字段（id、pageContent、metadata……），只覆盖 score，避免丢失元数据。
          ...candidate,
          // 新分数 = 命中查询词的个数 + 初筛分数 × 0.01。
          score:
            terms.reduce(
              // 累加器 score 初值为 0；每遇到一个出现在正文中的查询词就 +1。
              (score, term) =>
                score +
                (candidate.pageContent.toLowerCase().includes(term)
                  ? 1 // 该词在正文中出现：加 1 分
                  : 0), // 未出现：不加分
              0, // reduce 的初始累加值
            ) +
            // 初筛相似度只取 1%：只用于词面命中数相同时的“平局裁决”，避免反客为主。
            // 调大这个系数会让结果更接近初筛顺序，调小（如 0）则完全只看词面重合。
            candidate.score * 0.01,
        }))
        // 按重排分降序：命中查询词越多的片段排得越前。
        .sort((a, b) => b.score - a.score)
    )
  }
}
