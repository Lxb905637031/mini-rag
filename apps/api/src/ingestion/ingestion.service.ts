/**
 * @file apps/api/src/ingestion/ingestion.service.ts
 * @description 文档“摄入（ingestion）”服务：上传文件二进制直接入库 → 后台异步完成
 *              解析、切块、向量化、写入 Chroma；同时提供文档/切片查询与删除。
 *
 * 文件存在哪里（2026-09 改造）：
 *   现在上传的原始文件以 BLOB 形式保存在 SQLite 的 Document.content 字段里，
 *   不再长期写入本地磁盘。只是 PDF/Word 解析器只认识“磁盘文件路径”，
 *   所以后台处理时会先把数据库里的二进制写到操作系统临时目录（os.tmpdir()），
 *   解析完成后在 finally 中立刻删除——临时文件只是解析瞬间的中转，不做持久保存。
 *
 * 文档状态机（document.status）：
 *   PENDING（已创建，等待处理）→ PROCESSING（索引中）→ COMPLETED（就绪）
 *                                                ↘ ERROR（失败，errorMessage 记录原因）
 *
 * 为什么上传接口要“异步处理”：解析 PDF/Word、调用 Ollama 生成向量都比较慢，
 * 不能让 HTTP 上传请求一直阻塞。这里先把文件内容登记入库（状态 PENDING）立即返回，
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
// Node 文件系统异步 API：写临时文件、删除临时文件。
import { unlink, writeFile } from 'node:fs/promises'
// os.tmpdir()：操作系统临时目录（macOS 通常是 /var/folders/...）。
import { tmpdir } from 'node:os'
// path 工具：拼路径、取文件名。
import { basename, join } from 'node:path'

/**
 * 文档“摘要字段”白名单：查询/返回文档列表时刻意不包含 content。
 * 原因：content 是最大可达 10MB 的二进制，列表接口若把它一并查出并序列化成 JSON，
 * 既拖慢数据库查询，也会让前端收到巨大的无用响应（前端只展示文件名/状态等元数据）。
 * 只有后台 process() 真正需要解析文件时，才单独把 content 查出来。
 */
const documentSummarySelect = {
  id: true,
  knowledgeBaseId: true,
  originalName: true,
  mimeType: true,
  path: true,
  status: true,
  errorMessage: true,
  chunkCount: true,
  createdAt: true,
  updatedAt: true,
} as const

@Injectable()
export class IngestionService {
  // 应用启动后读取一次 RAG 配置并复用。
  private readonly config = loadConfig()
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 校验“知识库存在且属于当前用户”，是所有文档操作的统一入口检查。
   * @param knowledgeBaseId 知识库 id
   * @param ownerId 当前登录用户 id
   * @throws NotFoundException 知识库不存在或不属于当前用户时抛 404
   *         （与知识库模块保持一致：不暴露别人资源的存在性）
   */
  private async assertBaseOwned(knowledgeBaseId: string, ownerId: string) {
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, ownerId },
    })
    if (!knowledgeBase) throw new NotFoundException('Knowledge base not found')
  }

  /**
   * 校验“文档存在且其所属知识库归当前用户所有”，用于只拿到 documentId 的接口。
   * @param documentId 文档 id
   * @param ownerId 当前登录用户 id
   * @returns 文档记录（含 knowledgeBaseId，调用方可复用）
   * @throws NotFoundException 文档不存在或不属于当前用户时抛 404
   */
  private async assertDocumentOwned(documentId: string, ownerId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      // 只需要文档所属知识库的 id 用于归属判断，不带切片等大字段。
      select: { id: true, knowledgeBaseId: true },
    })
    // 文档不存在直接 404；存在还要进一步确认知识库归属。
    if (!document) throw new NotFoundException('Document not found')
    await this.assertBaseOwned(document.knowledgeBaseId, ownerId)
    return document
  }

  /**
   * 处理文件上传：校验知识库归属 → 把文件二进制与元数据直接写入数据库 → 触发后台索引。
   * @param knowledgeBaseId 目标知识库 id
   * @param file multer 解析出的上传文件（originalname 原始文件名、mimetype 类型、buffer 二进制内容）
   * @param ownerId 当前登录用户 id
   * @returns 新创建的文档记录（初始状态通常为 PENDING；不含 content 二进制大字段）
   * @throws NotFoundException 知识库不存在或不属于当前用户时抛 404
   */
  async upload(knowledgeBaseId: string, file: Express.Multer.File, ownerId: string) {
    // 先确认知识库存在且属于当前用户，避免把文件挂到别人的知识库上。
    await this.assertBaseOwned(knowledgeBaseId, ownerId)

    // 修正中文文件名乱码：multer 1.x 底层的 busboy 默认按 latin1 解码 multipart 里的
    // filename，而浏览器实际上传的是 UTF-8 原始字节，于是“高级前端专家.docx”会被解成
    // “é«çº§å....docx”。这里先按 latin1 把每个字符还原成原始字节，再按 UTF-8
    // 重新解码，即可得到真实文件名（纯英文/数字名每个字符都在 128 以内，转换后不变）。
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')

    // 文件不再落本地磁盘：multer memoryStorage 已把文件内容放在内存的 file.buffer 里，
    // 这里直接把这份二进制（Buffer）写入 SQLite 的 content BLOB 字段；
    // path 对新文档恒为 null（仅为兼容历史记录而保留的字段）。
    // select 保证返回给前端的记录不含 content，避免把数 MB 二进制再序列化进 HTTP 响应。
    const document = await this.prisma.document.create({
      data: {
        knowledgeBaseId,
        originalName,
        mimeType: file.mimetype,
        path: null,
        content: file.buffer,
      },
      select: documentSummarySelect,
    })

    // “发射后不管”：后台执行索引，不 await，所以接口能立刻返回。
    // void 表示刻意忽略返回的 Promise；.catch 兜底防止后台异常变成未处理的 Promise 拒绝
    //（process 内部已会把失败写入 ERROR 状态，这里吞掉仅是双重保险）。
    void this.process(document.id).catch(() => undefined)
    return document
  }

  /**
   * 查询某知识库下的全部文档，按创建时间倒序（最新上传的在前）。
   * @param knowledgeBaseId 知识库 id
   * @param ownerId 当前登录用户 id：先校验知识库归属，防止查询别人库里的文档
   */
  async list(knowledgeBaseId: string, ownerId: string) {
    // 归属校验不通过会抛 404。
    await this.assertBaseOwned(knowledgeBaseId, ownerId)
    return this.prisma.document.findMany({
      where: { knowledgeBaseId },
      orderBy: { createdAt: 'desc' },
      // 同样只取摘要字段，不把 content 二进制带进列表响应。
      select: documentSummarySelect,
    })
  }

  /**
   * 查询某文档切出的全部片段，按切片序号升序，供前端“查看切片”弹窗使用。
   * @param documentId 文档 id
   * @param ownerId 当前登录用户 id：先校验文档归属
   */
  async chunks(documentId: string, ownerId: string) {
    // 先确认该文档属于当前用户名下的知识库。
    await this.assertDocumentOwned(documentId, ownerId)
    return this.prisma.chunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
    })
  }

  /**
   * 删除文档：先删向量库中的向量，再清理历史磁盘文件（若有），最后删数据库记录。
   * 顺序上先清理“外部副本”，避免数据库删了但向量残留成孤儿数据。
   * @param documentId 要删除的文档 id
   * @param ownerId 当前登录用户 id：只能删除自己知识库下的文档
   * @returns 被删除的文档 id
   * @throws NotFoundException 文档不存在或不属于当前用户时抛 404
   */
  async remove(documentId: string, ownerId: string) {
    // 先做归属校验（文档不存在或属于别人都抛 404）。
    await this.assertDocumentOwned(documentId, ownerId)
    // 连带查出切片：向量库里的向量 id 就记录在切片的 metadata.chunkId 中。
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      // 只取删除真正需要的字段，尤其不要把 content 二进制查进内存——
      // 文档记录一删，库里的文件内容会随记录一起消失。
      select: {
        id: true,
        path: true,
        chunks: { select: { metadata: true } },
      },
    })
    // 理论上上面已校验过存在，这里再兜底一次，防止两步之间文档刚好被删。
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

    // 只有改造前的历史记录还会在磁盘上留文件（path 非空），这里顺手删除；
    // 文件本就不存在（ENOENT）则忽略，其它 IO 错误照常抛出。
    // 新文档的原始文件存在数据库 content 字段里，下面 delete 时随记录一并删除，无需动磁盘。
    if (document.path) {
      await unlink(document.path).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
    }

    // 最后删数据库记录（content 二进制与关联的 chunks 由数据库级联规则一并删除）。
    await this.prisma.document.delete({ where: { id: documentId } })
    return { id: documentId }
  }

  /**
   * 文档索引流水线（后台执行）：解析 → 切块 → 向量化入库 → 落库切片 → 标记完成；
   * 任何一步失败都把文档状态置为 ERROR 并记录原因，不让后台任务静默崩溃。
   * @param documentId 待处理的文档 id
   */
  async process(documentId: string) {
    // 重新查记录：上传与后台处理是两个时机，需拿到最新状态。
    // 这里必须显式 select 出 content（文件二进制）——后台解析全靠它；
    // 不直接用 findUnique 全量查询也是为了让“用到哪些字段”一目了然。
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        knowledgeBaseId: true,
        originalName: true,
        path: true,
        content: true,
      },
    })
    // 记录可能在排队期间被删除，直接结束即可。
    if (!document) return

    // 标记“处理中”，同时清空历史错误信息（支持对同一文档重新触发处理）。
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'PROCESSING', errorMessage: null },
    })

    // PDFLoader / DocxLoader / macOS textutil 都只能读取“磁盘上的文件路径”，
    // 不能直接吃内存里的 Buffer。因此解析前先把数据库中的二进制写到系统临时目录，
    // 文件名保留原始扩展名（解析器靠扩展名选择 PDF/Word/文本分支），
    // 并在 finally 中无条件删除——临时文件只是解析瞬间的中转，应用目录里不再留存文件。
    // filePath 最终指向要解析的文件；tempPath 非空表示文件是我们刚写出的临时文件。
    let filePath = document.path
    let tempPath: string | null = null
    try {
      if (document.content) {
        tempPath = join(tmpdir(), `mini-rag-${document.id}-${basename(document.originalName)}`)
        filePath = tempPath
        await writeFile(tempPath, document.content)
      }
      // 新旧两套存储都没有文件内容（极端的脏数据情况），直接报错进入 ERROR 状态，
      // 提示用户重新上传，而不是把难懂的 ENOENT 抛到前端。
      if (!filePath) {
        throw new Error('文档原始内容缺失：数据库中没有保存文件，请重新上传该文档')
      }

      // 步骤 1：嵌入模型客户端（切块时若策略需要也可能用到它）。
      const embeddings = createOllamaEmbeddings(this.config)

      // 步骤 2：按文件类型解析文件，得到带元数据的文本片段/页。
      const loaded = await loadDocument(filePath)
      // loadDocument 会把“入参路径”写进每个片段的 metadata.source/fileName；
      // 现在入参是系统临时路径（如 /var/folders/.../mini-rag-xxx-简历.pdf），没有展示意义，
      // 统一改写成用户上传时的真实文件名，避免临时路径污染数据库切片与 Chroma 向量元数据。
      for (const item of loaded) {
        item.metadata.source = document.originalName
        item.metadata.fileName = document.originalName
      }

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
    } finally {
      // 无论解析成功还是失败，都删除临时文件，保证磁盘上不残留上传内容。
      // 删除失败（如文件已不存在）只吞掉不抛出：不能让清理错误掩盖真正的处理结果。
      if (tempPath) {
        await unlink(tempPath).catch(() => undefined)
      }
    }
  }
}
