import type { LoadedChunk, SearchResult } from '../types.js'

export class Bm25Retriever {
  private readonly documents: LoadedChunk[]
  private readonly averageLength: number
  private readonly documentFrequency = new Map<string, number>()
  private readonly termFrequency: Map<string, number>[]

  constructor(documents: LoadedChunk[]) {
    this.documents = documents
    this.termFrequency = documents.map(document => {
      const frequencies = new Map<string, number>()
      for (const term of tokenize(document.pageContent))
        frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
      for (const term of frequencies.keys())
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1)
      return frequencies
    })
    this.averageLength =
      documents.length === 0
        ? 0
        : documents.reduce((sum, document) => sum + tokenize(document.pageContent).length, 0) /
          documents.length
  }

  search(query: string, k: number): SearchResult[] {
    const terms = tokenize(query)
    const scored = this.documents
      .map((document, index) => {
        const length = tokenize(document.pageContent).length || 1
        const score = terms.reduce((sum, term) => {
          const frequency = this.termFrequency[index].get(term) ?? 0
          if (!frequency) return sum
          const idf = Math.log(
            1 +
              (this.documents.length - (this.documentFrequency.get(term) ?? 0) + 0.5) /
                ((this.documentFrequency.get(term) ?? 0) + 0.5),
          )
          return (
            sum +
            idf *
              ((frequency * 2.2) /
                (frequency + 1.2 * (1 - 0.75 + (0.75 * length) / Math.max(this.averageLength, 1))))
          )
        }, 0)
        return {
          id: String(document.metadata.chunkId ?? index),
          pageContent: document.pageContent,
          score,
          metadata: document.metadata,
        }
      })
      .filter(item => item.score > 0)
    return scored.sort((a, b) => b.score - a.score).slice(0, k)
  }
}

function tokenize(text: string): string[] {
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
  return [...segmenter.segment(text.toLowerCase())]
    .filter(segment => segment.isWordLike)
    .map(segment => segment.segment)
}
