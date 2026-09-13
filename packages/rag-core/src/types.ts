import type { Document } from '@langchain/core/documents'

export type ChunkStrategy = 'fixed' | 'recursive' | 'semantic' | 'structure'
export type RetrievalMode = 'vector' | 'bm25' | 'hybrid'

export interface RagConfig {
  ollamaBaseUrl: string
  chatModel: string
  embeddingModel: string
  chromaUrl: string
  chromaCollection: string
  topK: number
  chunkSize: number
  chunkOverlap: number
}

export interface SearchResult {
  id: string
  pageContent: string
  score: number
  metadata: Record<string, unknown>
}

export interface RetrievalTrace {
  mode: RetrievalMode
  vector: SearchResult[]
  bm25: SearchResult[]
  fused: SearchResult[]
  reranked: SearchResult[]
  durationMs: number
}

export interface Reranker {
  rerank(query: string, candidates: SearchResult[]): Promise<SearchResult[]>
}

export interface LoadedChunk extends Document {
  metadata: Record<string, unknown> & { source: string; fileName: string }
}
