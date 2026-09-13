import type { SearchResult, RetrievalMode, RetrievalTrace } from '../types.js'
import { Bm25Retriever } from './bm25-retriever.js'
import { reciprocalRankFusion } from './rrf.js'
import type { Reranker } from '../types.js'

export interface VectorSearcher {
  search(query: string, k: number): Promise<SearchResult[]>
}

export class RetrievalService {
  constructor(
    private readonly vector: VectorSearcher,
    private readonly bm25: Bm25Retriever,
    private readonly reranker: Reranker,
  ) {}

  async search(
    query: string,
    mode: RetrievalMode,
    k: number,
    useRerank = false,
  ): Promise<RetrievalTrace> {
    const started = Date.now()
    const vector = mode === 'bm25' ? [] : await this.vector.search(query, k * 2)
    const bm25 = mode === 'vector' ? [] : this.bm25.search(query, k * 2)
    const fused =
      mode === 'hybrid'
        ? reciprocalRankFusion([vector, bm25], [0.7, 0.3])
        : mode === 'vector'
          ? vector
          : bm25
    const base = (fused.length ? fused : [...vector, ...bm25]).slice(0, k * 2)
    const reranked = useRerank ? await this.reranker.rerank(query, base) : base
    return {
      mode,
      vector,
      bm25,
      fused,
      reranked: reranked.slice(0, k),
      durationMs: Date.now() - started,
    }
  }
}
