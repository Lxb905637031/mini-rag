/**
 * @file packages/rag-core/src/retrieval/bm25-retriever.ts
 * @description BM25 关键词检索器（手写实现，无需外部搜索引擎）。
 *
 * 小白导读——BM25 在干什么：
 * - 它是传统“关键词搜索”的经典打分算法：查询词在某文档中出现得越多、文档越短，
 *   得分越高；而在“所有文档里都常见”的词（类似“的/是/这个”）会被降权（IDF 思想）。
 * - 与向量检索互补：向量擅长理解语义（“电脑”≈“计算机”），BM25 擅长精确命中稀有关键词
 *   （型号、报错码、人名、专有名词），所以系统把两者混合使用。
 * - 中文分词使用 Node 内置的 Intl.Segmenter，无需额外分词库。
 *
 * 打分公式（BM25 变体，参数 k1=1.2、b=0.75）：
 *   score = Σ IDF(词) × ( tf × (k1+1) ) / ( tf + k1 × (1 - b + b × |d|/avgdl) )
 */
import type { LoadedChunk, SearchResult } from '../types.js'

export class Bm25Retriever {
  // 被检索的全部文档（切片）。
  private readonly documents: LoadedChunk[]
  // 所有文档的平均词数（用于惩罚过长的文档）。
  private readonly averageLength: number
  // 每个词出现在多少篇文档中（document frequency，用于计算 IDF）。
  private readonly documentFrequency = new Map<string, number>()
  // 每篇文档各自的“词 → 出现次数”表（term frequency）。
  private readonly termFrequency: Map<string, number>[]

  /**
   * 构造时一次性把语料的统计信息全部算好（离线建索引），之后每次 search 只做打分，速度快。
   * @param documents 当前知识库的全部切片
   */
  constructor(documents: LoadedChunk[]) {
    this.documents = documents
    this.termFrequency = documents.map(document => {
      // 统计这篇文档里每个词的出现次数。
      const frequencies = new Map<string, number>()
      for (const term of tokenize(document.pageContent))
        frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
      // 这篇文档里出现过的每个词，其“文档频率”全局 +1（同一篇文档内重复出现只算一次）。
      for (const term of frequencies.keys())
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1)
      return frequencies
    })
    // 平均文档长度：所有文档词数之和 / 文档数；空语料记为 0 防止除以 NaN。
    this.averageLength =
      documents.length === 0
        ? 0
        : documents.reduce((sum, document) => sum + tokenize(document.pageContent).length, 0) /
          documents.length
  }

  /**
   * 执行一次关键词检索。
   * @param query 用户问题
   * @param k 返回前 k 条
   * @returns 按 BM25 分数降序的结果数组；与所有查询词都不沾边的文档得 0 分，会被过滤掉
   */
  search(query: string, k: number): SearchResult[] {
    const terms = tokenize(query)
    const scored = this.documents
      .map((document, index) => {
        // 本文档的词数；空文档按 1 处理，避免分母为 0。
        const length = tokenize(document.pageContent).length || 1
        // 把每个查询词对本文档的贡献累加起来。
        const score = terms.reduce((sum, term) => {
          // tf：该词在本文档中的出现次数；没出现则贡献 0。
          const frequency = this.termFrequency[index].get(term) ?? 0
          if (!frequency) return sum
          // IDF（逆文档频率）：词越稀有值越大；到处都有的词值小。
          // 这里用的是带 +0.5 平滑的变体，保证值恒为正。
          const idf = Math.log(
            1 +
              (this.documents.length - (this.documentFrequency.get(term) ?? 0) + 0.5) /
                ((this.documentFrequency.get(term) ?? 0) + 0.5),
          )
          // BM25 词频饱和项：2.2 = k1+1，1.2 = k1，0.75 = b。
          // 词频带来的收益会快速饱和（一篇文章提 10 次不等于比提 2 次相关 5 倍）；
          // 括号内 (0.75 × 文档长度/平均长度) 实现“长文档适度降权”。
          return (
            sum +
            idf *
              ((frequency * 2.2) /
                (frequency + 1.2 * (1 - 0.75 + (0.75 * length) / Math.max(this.averageLength, 1))))
          )
        }, 0)
        return {
          id: String(document.metadata.chunkId ?? index), // 结果 id：元数据 chunkId 兜底下标
          pageContent: document.pageContent,
          score,
          metadata: document.metadata,
        }
      })
      // 过滤掉总分 0 的文档（没有任何查询词命中）。
      .filter(item => item.score > 0)
    // 降序排列后只取前 k 条。
    return scored.sort((a, b) => b.score - a.score).slice(0, k)
  }
}

/**
 * 分词：把任意文本切成小写的“词”数组。
 * 使用 Node 内置 Intl.Segmenter 的中文词粒度切分，中英文都能处理，无需第三方依赖。
 */
function tokenize(text: string): string[] {
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
  return (
    [...segmenter.segment(text.toLowerCase())]
      // isWordLike 为 true 表示这是“词”（自动跳过标点和空白）。
      .filter(segment => segment.isWordLike)
      .map(segment => segment.segment)
  )
}
