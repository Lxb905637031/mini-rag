import { describe, expect, it } from 'vitest'
import { Bm25Retriever } from './bm25-retriever.js'
import { reciprocalRankFusion } from './rrf.js'

const document = (id: string, text: string) =>
  ({ pageContent: text, metadata: { chunkId: id, fileName: `${id}.md`, source: id } }) as any

describe('BM25 and RRF', () => {
  it('ranks exact terms above unrelated content', () => {
    const results = new Bm25Retriever([
      document('a', 'RRF ranks documents by reciprocal rank'),
      document('b', 'cooking recipes'),
    ]).search('RRF ranking', 2)
    expect(results[0]?.id).toBe('a')
  })
  it('deduplicates documents during fusion', () => {
    const result = reciprocalRankFusion(
      [
        [{ id: 'a', pageContent: 'a', score: 1, metadata: {} }],
        [{ id: 'a', pageContent: 'a', score: 0.5, metadata: {} }],
      ],
      [0.7, 0.3],
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.score).toBeGreaterThan(0)
  })
})
