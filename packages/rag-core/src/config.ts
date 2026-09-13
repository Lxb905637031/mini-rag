import 'dotenv/config'
import type { RagConfig } from './types.js'

const positiveInt = (name: string, value: string | undefined, fallback: number) => {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`)
  return parsed
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RagConfig {
  // mxbai-embed-large accepts roughly 512 tokens; 300 characters keeps
  // Chinese and mixed-language chunks safely below that limit.
  const chunkSize = positiveInt('RAG_CHUNK_SIZE', env.RAG_CHUNK_SIZE, 300)
  const chunkOverlap = positiveInt('RAG_CHUNK_OVERLAP', env.RAG_CHUNK_OVERLAP, 40)
  if (chunkOverlap >= chunkSize)
    throw new Error('RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE')
  return {
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    chatModel: env.OLLAMA_CHAT_MODEL ?? 'llama3.2:3b',
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text',
    chromaUrl: env.CHROMA_URL ?? 'http://127.0.0.1:8000',
    chromaCollection: env.CHROMA_COLLECTION ?? 'mini_rag_documents',
    topK: positiveInt('RAG_TOP_K', env.RAG_TOP_K, 4),
    chunkSize,
    chunkOverlap,
  }
}
