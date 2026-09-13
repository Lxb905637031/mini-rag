import { Chroma } from '@langchain/community/vectorstores/chroma'
import type { Embeddings } from '@langchain/core/embeddings'
import type { Document } from '@langchain/core/documents'
import type { SearchResult } from '../types.js'

export class ChromaStore {
  constructor(
    private readonly store: Chroma,
    private readonly knowledgeBaseId?: string,
  ) {}

  static async create(
    embeddings: Embeddings,
    collectionName: string,
    url: string,
    knowledgeBaseId?: string,
  ): Promise<ChromaStore> {
    const store = new Chroma(embeddings, { collectionName, url })
    return new ChromaStore(store, knowledgeBaseId)
  }

  async addDocuments(documents: Document[]): Promise<void> {
    await this.store.addDocuments(documents, {
      ids: documents.map(document => String(document.metadata.chunkId)),
    })
  }
  async search(query: string, k: number): Promise<SearchResult[]> {
    const results = await this.store.similaritySearchWithScore(
      query,
      k,
      this.knowledgeBaseId ? { knowledgeBaseId: this.knowledgeBaseId } : undefined,
    )
    return results.map(([document, distance], index) => ({
      id: String(document.metadata.chunkId ?? index),
      pageContent: document.pageContent,
      score: 1 / (1 + distance),
      metadata: { ...document.metadata, distance },
    }))
  }
  async deleteIds(ids: string[]): Promise<void> {
    if (ids.length) await this.store.delete({ ids })
  }
}
