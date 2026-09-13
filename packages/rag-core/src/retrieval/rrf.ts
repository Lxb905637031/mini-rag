import type { SearchResult } from '../types.js'

export function reciprocalRankFusion(
  lists: SearchResult[][],
  weights: number[] = lists.map(() => 1),
  rrfK = 60,
): SearchResult[] {
  const map = new Map<string, { result: SearchResult; score: number; firstRank: number }>()
  lists.forEach((list, listIndex) =>
    list.forEach((result, index) => {
      const rank = index + 1
      const id = result.id || String(result.metadata.chunkId ?? `${listIndex}-${index}`)
      const current = map.get(id)
      const score = (weights[listIndex] ?? 1) / (rrfK + rank)
      if (current) current.score += score
      else map.set(id, { result: { ...result, id }, score, firstRank: rank })
    }),
  )
  return [...map.values()]
    .sort((a, b) => b.score - a.score || a.firstRank - b.firstRank)
    .map(item => ({ ...item.result, score: item.score }))
}
