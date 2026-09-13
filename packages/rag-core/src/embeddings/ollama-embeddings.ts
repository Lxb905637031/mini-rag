import { OllamaEmbeddings } from '@langchain/ollama'
import type { RagConfig } from '../types.js'

export function createOllamaEmbeddings(config: RagConfig): OllamaEmbeddings {
  return new OllamaEmbeddings({ baseUrl: config.ollamaBaseUrl, model: config.embeddingModel })
}
