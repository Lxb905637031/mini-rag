/**
 * @file packages/rag-core/src/retrieval/rrf.ts
 * @description RRF（Reciprocal Rank Fusion，倒数排名融合）：把多路检索结果
 *              （如向量检索 + BM25）按“排名”而非原始分合并成一个列表。
 *
 * 小白导读——为什么不用分数直接相加：
 * - 向量相似度（通常 0~1）和 BM25（无上界的词频分）量纲完全不同，直接相加没有意义。
 * - RRF 只看“每条结果在各自列表里排第几名”：排名越靠前得分越高，公式为
 *       贡献分 = 权重 / (k + 排名)，k 是平滑常数（常用 60）。
 * - 同一条结果（按 id 去重）若在多路都出现，贡献分累加——两路都认为它相关，它就更靠前。
 */
import type { SearchResult } from '../types.js'

/**
 * @param lists 多路检索结果（每一路内部已按相关度从高到低排好序）
 * @param weights 每一路的权重，默认全为 1；本项目调用时传 [0.7, 0.3]（更偏向量）
 * @param rrfK 平滑常数 k，默认 60；调大则名次差距被进一步压缩（头尾分差变小），
 *             调小则排名更“陡峭”，头部结果优势更明显
 * @returns 融合去重并重新排序后的结果数组，score 字段被替换为融合分
 */
export function reciprocalRankFusion(
  lists: SearchResult[][],
  weights: number[] = lists.map(() => 1),
  rrfK = 60,
): SearchResult[] {
  // 用 Map 按 id 聚合同一条结果，保存累计分和它最早出现的名次（平局时用）。
  const map = new Map<string, { result: SearchResult; score: number; firstRank: number }>()
  lists.forEach((list, listIndex) =>
    list.forEach((result, index) => {
      // 排名从 1 开始（数组下标从 0 开始，所以 +1）。
      const rank = index + 1
      // id 优先用结果自带的 id；没有就用元数据 chunkId；再没有就用“路号-下标”兜底，保证可去重。
      const id = result.id || String(result.metadata.chunkId ?? `${listIndex}-${index}`)
      const current = map.get(id)
      // 该路给这条结果的贡献分 = 该路权重 / (k + 名次)。
      const score = (weights[listIndex] ?? 1) / (rrfK + rank)
      if (current) {
        // 已在别的路出现过：累加贡献分（多路命中 = 更可靠）。
        current.score += score
      } else {
        // 首次出现：登记，同时复制结果并补上 id。
        map.set(id, { result: { ...result, id }, score, firstRank: rank })
      }
    }),
  )
  return (
    [...map.values()]
      // 先按融合分降序；分数相同时，最早在某一路拿到更好名次的排前面（保证排序稳定）。
      .sort((a, b) => b.score - a.score || a.firstRank - b.firstRank)
      // 输出时还原成 SearchResult 形状，只把 score 换成融合分。
      .map(item => ({ ...item.result, score: item.score }))
  )
}
