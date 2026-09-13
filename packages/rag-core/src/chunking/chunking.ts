import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import type { Embeddings } from '@langchain/core/embeddings'
import type { Document } from '@langchain/core/documents'
import type { ChunkStrategy, LoadedChunk } from '../types.js'

export interface ChunkOptions {
  size: number
  overlap: number
  embeddings?: Embeddings
}

export async function chunkDocuments(
  documents: LoadedChunk[],
  strategy: ChunkStrategy,
  options: ChunkOptions,
): Promise<LoadedChunk[]> {
  if (strategy === 'fixed') return fixedChunks(documents, options.size, options.overlap)
  if (strategy === 'semantic') return semanticChunks(documents, options)
  if (strategy === 'structure') return structureChunks(documents, options)
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options.size,
    chunkOverlap: options.overlap,
  })
  return (await splitter.splitDocuments(documents)) as LoadedChunk[]
}

function fixedChunks(documents: Document[], size: number, overlap: number): LoadedChunk[] {
  return documents.flatMap(document => {
    const chunks: LoadedChunk[] = []
    for (let start = 0; start < document.pageContent.length; start += size - overlap) {
      const pageContent = document.pageContent.slice(start, start + size).trim()
      if (pageContent)
        chunks.push({ pageContent, metadata: { ...document.metadata } } as LoadedChunk)
    }
    return chunks
  })
}

async function semanticChunks(
  documents: Document[],
  options: ChunkOptions,
): Promise<LoadedChunk[]> {
  if (!options.embeddings) throw new Error('Semantic chunking requires an embeddings provider')
  const result: LoadedChunk[] = []
  for (const document of documents) {
    const sentences = document.pageContent.split(/(?<=[。！？.!?])\s+/).filter(Boolean)
    if (sentences.length < 2) {
      result.push(document as LoadedChunk)
      continue
    }
    const vectors = await options.embeddings.embedDocuments(sentences)
    let current = sentences[0]
    for (let index = 1; index < sentences.length; index++) {
      const similarity = cosine(vectors[index - 1], vectors[index])
      if (similarity < 0.72 || current.length + sentences[index].length > options.size) {
        result.push({
          pageContent: current.trim(),
          metadata: { ...document.metadata },
        } as LoadedChunk)
        current = sentences[index]
      } else current += ` ${sentences[index]}`
    }
    if (current.trim())
      result.push({
        pageContent: current.trim(),
        metadata: { ...document.metadata },
      } as LoadedChunk)
  }
  return result
}

function structureChunks(documents: Document[], options: ChunkOptions): LoadedChunk[] {
  return documents.flatMap(document =>
    document.pageContent.split(/(?=^#{1,6}\s)/m).flatMap(section => {
      const content = section.trim()
      if (!content) return []
      const chunks: LoadedChunk[] = []
      for (let start = 0; start < content.length; start += options.size - options.overlap) {
        const pageContent = content.slice(start, start + options.size).trim()
        if (pageContent)
          chunks.push({
            pageContent,
            metadata: {
              ...document.metadata,
              source: String(document.metadata.source ?? 'preview'),
              fileName: String(document.metadata.fileName ?? 'preview'),
              structure: section.match(/^#{1,6}\s+(.+)/)?.[1],
            },
          } as LoadedChunk)
      }
      return chunks
    }),
  )
}

function cosine(a: number[], b: number[]): number {
  const denominator =
    Math.sqrt(a.reduce((sum, value) => sum + value * value, 0)) *
    Math.sqrt(b.reduce((sum, value) => sum + value * value, 0))
  return denominator === 0
    ? 0
    : a.reduce((sum, value, index) => sum + value * b[index], 0) / denominator
}
