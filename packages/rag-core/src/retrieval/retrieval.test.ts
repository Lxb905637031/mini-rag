/**
 * @file packages/rag-core/src/retrieval/retrieval.test.ts
 * @description 检索模块的单元测试（Vitest）。不依赖 Ollama/Chroma，纯内存验证算法行为。
 *
 * 小白导读：
 * - describe 把一组相关测试归为一组；it(中文语义即“它应该……”) 是一条具体测试用例；
 * - expect(实际值).toBe/ toHaveLength/toBeGreaterThan 是“断言”，不满足测试就失败。
 */
import { describe, expect, it } from 'vitest'
import { Bm25Retriever } from './bm25-retriever.js'
import { reciprocalRankFusion } from './rrf.js'

/** 测试辅助函数：用最少的字段快速构造一个“文档”（as any 绕开完整类型，仅测试用）。 */
const document = (id: string, text: string) =>
  ({
    pageContent: text,
    metadata: { chunkId: id, fileName: `${id}.md`, source: id },
  }) as any

describe('BM25 and RRF', () => {
  // 用例 1：查询词精确命中的文档应当排在无关文档前面。
  it('ranks exact terms above unrelated content', () => {
    const results = new Bm25Retriever([
      document('a', 'RRF ranks documents by reciprocal rank'), // 与查询词高度相关
      document('b', 'cooking recipes'), // 完全无关
    ]).search('RRF ranking', 2)
    // 断言：第一名的 id 必须是 'a'（若不是，说明 BM25 打分/排序有问题）。
    expect(results[0]?.id).toBe('a')
  })

  // 用例 2：同一条结果出现在多路列表中时，RRF 融合后必须按 id 去重而不是出现两次。
  it('deduplicates documents during fusion', () => {
    const result = reciprocalRankFusion(
      [
        [{ id: 'a', pageContent: 'a', score: 1, metadata: {} }],
        [{ id: 'a', pageContent: 'a', score: 0.5, metadata: {} }],
      ],
      [0.7, 0.3], // 两路权重
    )
    // 断言：融合结果只剩 1 条。
    expect(result).toHaveLength(1)
    // 断言：融合分是一个正数（两路贡献分都累加在这一条上）。
    expect(result[0]?.score).toBeGreaterThan(0)
  })
})
