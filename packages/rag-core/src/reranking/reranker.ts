import type { Reranker, SearchResult } from '../types.js'

export class LexicalReranker implements Reranker {
  async rerank(query: string, candidates: SearchResult[]): Promise<SearchResult[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return candidates
      .map(candidate => ({
        ...candidate,
        score:
          terms.reduce(
            (score, term) => score + (candidate.pageContent.toLowerCase().includes(term) ? 1 : 0),
            0,
          ) +
          candidate.score * 0.01,
      }))
      .sort((a, b) => b.score - a.score)
  }
}
