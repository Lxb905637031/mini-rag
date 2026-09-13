/**
 * @file apps/api/src/ingestion/ingestion.service.ts
 * @description 文档“摄入（ingestion）”服务：上传落盘 → 登记数据库 → 后台异步完成
 *              解析、切块、向量化、写入 Chroma；同时提供文档/切片查询与删除。
 *
 * 文档状态机（document.status）：
 *   PENDING（已创建，等待处理）→ PROCESSING（索引中）→ COMPLETED（就绪）
 *                                                ↘ ERROR（失败，errorMessage 记录原因）
 *
 * 为什么上传接口要“异步处理”：解析 PDF/Word、调用 Ollama 生成向量都比较慢，
 * 不能让 HTTP 上传请求一直阻塞。这里先把文件落盘并登记（状态 PENDING）立即返回，
 * 真正的索引在后台进行；前端通过定时轮询文档列表观察状态变化。
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  createOllamaEmbeddings, // 创建嵌入模型客户端
  chunkDocuments, // 把长文档切成小片段（chunks）
  loadDocument, // 按文件类型解析出纯文本
  ChromaStore, // 向量库封装
  loadConfig, // 读取环境变量配置
} from '@mini-rag/core'
import { PrismaService } from '../prisma/prisma.service.js'
// Node 文件系统异步 API：建目录、删文件、写文件。
import { mkdir, unlink, writeFile } from 'node:fs/promises'
// path 工具：拼路径、取文件名。
import { basename, join } from 'node:path'

@Injectable()
export class IngestionService {
  // 应用启动后读取一次 RAG 配置并复用。
  private readonly config = loadConfig()
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 处理文件上传：校验知识库 → 保存到磁盘 → 在数据库登记文档 → 触发后台索引。
   * @param knowledgeBaseId 目标知识库 id
   * @param file multer 解析出的上传文件（originalname 原始文件名、mimetype 类型、buffer 二进制内容）
   * @returns 新创建的文档记录（初始状态通常为 PENDING）
   * @throws NotFoundException 知识库不存在时抛 404
   */
  async upload(knowledgeBaseId: string, file: Express.Multer.File) {
    // 先确认知识库存在，避免把文件挂到一个不存在的知识库上。
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
    })
    if (!knowledgeBase) throw new NotFoundException('Knowledge base not found')

    // 上传目录可由环境变量指定，默认 ./data/uploads。
    const directory = process.env.UPLOAD_DIR ?? './data/uploads'
    // recursive: true —— 目录已存在不报错，父目录缺失则一并创建。
    await mkdir(directory, { recursive: true })
    // 文件名加时间戳前缀，防止同名文件互相覆盖；basename 去掉路径部分，防止路径穿越。
    const path = join(directory, `${Date.now()}-${basename(file.originalname)}`)
    // file.buffer 是内存中的文件二进制内容（multer memoryStorage），这里写入磁盘。
    await writeFile(path, file.buffer)

    // 在数据库登记一条文档记录（关联知识库、保存原始文件名/类型/磁盘路径）。
    const document = await this.prisma.document.create({
      data: {
        knowledgeBaseId,
        originalName: file.originalname,
        mimeType: file.mimetype,
        path,
      },
    })

    // “发射后不管”：后台执行索引，不 await，所以接口能立刻返回。
    // void 表示刻意忽略返回的 Promise；.catch 兜底防止后台异常变成未处理的 Promise 拒绝
    //（process 内部已会把失败写入 ERROR 状态，这里吞掉仅是双重保险）。
    void this.process(document.id).catch(() => undefined)
    return document
  }

  /** 查询某知识库下的全部文档，按创建时间倒序（最新上传的在前）。 */
  list(knowledgeBaseId: string) {
    return this.prisma.document.findMany({
      where: { knowledgeBaseId },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** 查询某文档切出的全部片段，按切片序号升序，供前端“查看切片”弹窗使用。 */
  chunks(documentId: string) {
    return this.prisma.chunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
    })
  }

  /**
   * 删除文档：先删向量库中的向量，再删磁盘文件，最后删数据库记录。
   * 顺序上先清理“外部副本”，避免数据库删了但向量残留成孤儿数据。
   * @param documentId 要删除的文档 id
   * @returns 被删除的文档 id
   * @throws NotFoundException 文档不存在时抛 404
   */
  async remove(documentId: string) {
    // 连带查出切片：向量库里的向量 id 就记录在切片的 metadata.chunkId 中。
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { chunks: true },
    })
    if (!document) throw new NotFoundException('Document not found')

    // 连接向量库，准备按 id 删除该文档的所有向量。
    const store = await ChromaStore.create(
      createOllamaEmbeddings(this.config),
      this.config.chromaCollection,
      this.config.chromaUrl,
    )
    // 逐个取出向量 id：优先用元数据里的 chunkId，缺失时按“文档id-序号”规则兜底
    //（与 process 中写入时的命名规则保持一致）。
    await store.deleteIds(
      document.chunks.map((chunk, index) =>
        String(
          (chunk.metadata as Record<string, unknown> | null)?.chunkId ?? `${document.id}-${index}`,
        ),
      ),
    )

    // 删除磁盘上的原始文件；若文件本就不存在（ENOENT）则忽略，其它 IO 错误照常抛出。
    await unlink(document.path).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })

    // 最后删数据库记录（关联的 chunks 由 schema 中的级联规则一并删除）。
    await this.prisma.document.delete({ where: { id: documentId } })
    return { id: documentId }
  }

  /**
   * 文档索引流水线（后台执行）：解析 → 切块 → 向量化入库 → 落库切片 → 标记完成；
   * 任何一步失败都把文档状态置为 ERROR 并记录原因，不让后台任务静默崩溃。
   * @param documentId 待处理的文档 id
   */
  async process(documentId: string) {
    // 重新查记录：上传与后台处理是两个时机，需拿到最新的文件路径等信息。
    const document = await this.prisma.document.findUnique({ where: { id: documentId } })
    // 记录可能在排队期间被删除，直接结束即可。
    if (!document) return

    // 标记“处理中”，同时清空历史错误信息（支持对同一文档重新触发处理）。
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'PROCESSING', errorMessage: null },
    })
    try {
      // 步骤 1：嵌入模型客户端（切块时若策略需要也可能用到它）。
      const embeddings = createOllamaEmbeddings(this.config)

      // 步骤 2：按文件类型解析磁盘文件，得到带元数据的文本片段/页。
      const loaded = await loadDocument(document.path)

      // 步骤 3：切块。固定使用 recursive（递归按标点/换行切分，语义更完整）。
      const chunks = await chunkDocuments(loaded, 'recursive', {
        // 即使旧 .env 还写着以前的 800 字符，这里也压到 300 以内，
        // 保证送给嵌入模型的文本不超过 Ollama 约 512 token 的上下文窗口。
        size: Math.min(this.config.chunkSize, 300),
        // 重叠长度同样封顶 40，避免相邻块完全失去上下文衔接。
        overlap: Math.min(this.config.chunkOverlap, 40),
        embeddings,
      })

      // 连接向量库（与上传处理共用同一个 collection 配置）。
      const store = await ChromaStore.create(
        embeddings,
        this.config.chromaCollection,
        this.config.chromaUrl,
      )

      // 步骤 4：给每个切片补充可追溯元数据（向量 id、文档 id、知识库 id）。
      const prepared = chunks.map((chunk, index) => ({
        ...chunk,
        metadata: {
          ...chunk.metadata,
          // 向量库中的主键，规则为“文档id-序号”，删除文档时按它定位向量。
          chunkId: `${document.id}-${index}`,
          documentId,
          knowledgeBaseId: document.knowledgeBaseId,
        },
      }))

      // 步骤 5：写入向量库（内部会调用嵌入模型生成向量后再存入 Chroma）。
      await store.addDocuments(prepared)

      // 步骤 6：用一个数据库事务同时完成“清旧切片 → 写新切片 → 更新文档状态”，
      // 保证三者要么全部成功、要么全部回滚，不会出现数据库与界面状态不一致。
      await this.prisma.$transaction([
        // 先删旧切片：兼容同一文档被重新处理的场景。
        this.prisma.chunk.deleteMany({ where: { documentId } }),
        this.prisma.chunk.createMany({
          data: prepared.map((chunk, index) => {
            const metadata = chunk.metadata as Record<string, unknown>
            return {
              documentId,
              content: chunk.pageContent, // 切片正文（SQLite 里留一份，供 BM25/前端展示）
              chunkIndex: index, // 切片顺序号
              // 页码仅在元数据里确实是数字时保存，否则为空。
              page: typeof metadata.page === 'number' ? metadata.page : null,
              metadata: metadata as any, // 原始元数据整体以 JSON 形式保存
            }
          }),
        }),
        // 切片数写回文档记录，状态置为“就绪”。
        this.prisma.document.update({
          where: { id: documentId },
          data: { status: 'COMPLETED', chunkCount: prepared.length },
        }),
      ])
    } catch (error) {
      // 任意环节失败：记录 ERROR 状态与错误信息，前端轮询时即可展示失败原因。
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
