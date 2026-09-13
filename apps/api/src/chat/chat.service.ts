import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  Bm25Retriever,
  ChromaStore,
  createOllamaAnswerGenerator,
  createOllamaEmbeddings,
  LexicalReranker,
  loadConfig,
  RagApplication,
  RetrievalService,
} from '@mini-rag/core'
import { PrismaService } from '../prisma/prisma.service.js'

@Injectable()
export class ChatService {
  private readonly config = loadConfig()
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async query(input: {
    knowledgeBaseId: string
    query: string
    mode?: 'vector' | 'bm25' | 'hybrid'
    topK?: number
    rerank?: boolean
  }) {
    const base = await this.prisma.knowledgeBase.findUnique({
      where: { id: input.knowledgeBaseId },
      include: { documents: { include: { chunks: true } } },
    })
    if (!base) throw new NotFoundException('Knowledge base not found')
    const embeddings = createOllamaEmbeddings(this.config)
    const store = await ChromaStore.create(
      embeddings,
      this.config.chromaCollection,
      this.config.chromaUrl,
      input.knowledgeBaseId,
    )
    const chunks = base.documents.flatMap(document =>
      document.chunks.map(chunk => {
        const metadata = (chunk.metadata as Record<string, unknown>) ?? {}
        return {
          pageContent: chunk.content,
          metadata: {
            ...metadata,
            chunkId: String(metadata.chunkId ?? chunk.id),
            documentId: chunk.documentId,
            fileName: document.originalName,
          },
        } as any
      }),
    )
    const retrieval = new RetrievalService(store, new Bm25Retriever(chunks), new LexicalReranker())
    const app = new RagApplication(retrieval, createOllamaAnswerGenerator(this.config))
    const result = await app.answerQuestion({
      query: input.query,
      mode: input.mode ?? 'hybrid',
      topK: input.topK ?? this.config.topK,
      rerank: input.rerank,
    })
    return result
  }
}
