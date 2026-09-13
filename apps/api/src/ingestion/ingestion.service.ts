import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  createOllamaEmbeddings,
  chunkDocuments,
  loadDocument,
  ChromaStore,
  loadConfig,
} from '@mini-rag/core'
import { PrismaService } from '../prisma/prisma.service.js'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

@Injectable()
export class IngestionService {
  private readonly config = loadConfig()
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async upload(knowledgeBaseId: string, file: Express.Multer.File) {
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
    })
    if (!knowledgeBase) throw new NotFoundException('Knowledge base not found')
    const directory = process.env.UPLOAD_DIR ?? './data/uploads'
    await mkdir(directory, { recursive: true })
    const path = join(directory, `${Date.now()}-${basename(file.originalname)}`)
    await writeFile(path, file.buffer)
    const document = await this.prisma.document.create({
      data: { knowledgeBaseId, originalName: file.originalname, mimeType: file.mimetype, path },
    })
    void this.process(document.id).catch(() => undefined)
    return document
  }

  list(knowledgeBaseId: string) {
    return this.prisma.document.findMany({
      where: { knowledgeBaseId },
      orderBy: { createdAt: 'desc' },
    })
  }
  chunks(documentId: string) {
    return this.prisma.chunk.findMany({ where: { documentId }, orderBy: { chunkIndex: 'asc' } })
  }

  async remove(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { chunks: true },
    })
    if (!document) throw new NotFoundException('Document not found')
    const store = await ChromaStore.create(
      createOllamaEmbeddings(this.config),
      this.config.chromaCollection,
      this.config.chromaUrl,
    )
    await store.deleteIds(
      document.chunks.map((chunk, index) =>
        String(
          (chunk.metadata as Record<string, unknown> | null)?.chunkId ?? `${document.id}-${index}`,
        ),
      ),
    )
    await unlink(document.path).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    await this.prisma.document.delete({ where: { id: documentId } })
    return { id: documentId }
  }

  async process(documentId: string) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } })
    if (!document) return
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'PROCESSING', errorMessage: null },
    })
    try {
      const embeddings = createOllamaEmbeddings(this.config)
      const loaded = await loadDocument(document.path)
      const chunks = await chunkDocuments(loaded, 'recursive', {
        // Keep embedding inputs below Ollama's 512-token context window even
        // when an older .env still contains the previous 800-character value.
        size: Math.min(this.config.chunkSize, 300),
        overlap: Math.min(this.config.chunkOverlap, 40),
        embeddings,
      })
      const store = await ChromaStore.create(
        embeddings,
        this.config.chromaCollection,
        this.config.chromaUrl,
      )
      const prepared = chunks.map((chunk, index) => ({
        ...chunk,
        metadata: {
          ...chunk.metadata,
          chunkId: `${document.id}-${index}`,
          documentId,
          knowledgeBaseId: document.knowledgeBaseId,
        },
      }))
      await store.addDocuments(prepared)
      await this.prisma.$transaction([
        this.prisma.chunk.deleteMany({ where: { documentId } }),
        this.prisma.chunk.createMany({
          data: prepared.map((chunk, index) => {
            const metadata = chunk.metadata as Record<string, unknown>
            return {
              documentId,
              content: chunk.pageContent,
              chunkIndex: index,
              page: typeof metadata.page === 'number' ? metadata.page : null,
              metadata: metadata as any,
            }
          }),
        }),
        this.prisma.document.update({
          where: { id: documentId },
          data: { status: 'COMPLETED', chunkCount: prepared.length },
        }),
      ])
    } catch (error) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'ERROR',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }
}
