import type { AnswerGenerator } from './generation/answer-generator.js'
import type { ChunkStrategy, RetrievalMode, RetrievalTrace } from './types.js'
import type { RetrievalService } from './retrieval/retrieval-service.js'

export class RagApplication {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly generator: AnswerGenerator,
  ) {}

  async answerQuestion(input: {
    query: string
    mode: RetrievalMode
    topK: number
    rerank?: boolean
    chunkStrategy?: ChunkStrategy
  }): Promise<{ answer: string; trace: RetrievalTrace }> {
    if (!input.query.trim()) throw new Error('Query cannot be empty')
    const trace = await this.retrieval.search(
      input.query.trim(),
      input.mode,
      input.topK,
      input.rerank,
    )
    const generated = await this.generator.answer(input.query.trim(), trace.reranked)
    return { answer: generated.answer, trace }
  }
}
