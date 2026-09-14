/**
 * 文档摄入（ingestion）控制器（Controller 层）
 *
 * 业务职责：
 *   负责某个知识库下“文档（documents）”的上传、列表、切块查看与删除。
 *   文档上传后，真正的“解析 -> 切块 -> 向量化 -> 写入 Chroma”流水线在
 *   IngestionService 中以后台异步方式执行；这里只负责接收文件和查询。
 *
 * 注意路由前缀里带两级参数：/knowledge-bases/:knowledgeBaseId/documents
 *
 * HTTP 路由表（路径中的 :xxx 是动态参数）：
 *   POST   /knowledge-bases/:knowledgeBaseId/documents
 *          上传一个文档文件（multipart/form-data，文件字段名必须是 file）
 *   GET    /knowledge-bases/:knowledgeBaseId/documents
 *          查询某个知识库下的全部文档
 *   GET    /knowledge-bases/:knowledgeBaseId/documents/:documentId/chunks
 *          查询某个文档切分出来的全部文本块（用于前端预览切块效果）
 *   DELETE /knowledge-bases/:knowledgeBaseId/documents/:documentId
 *          删除一个文档（同时清理 Chroma 向量和数据库记录；
 *          仅改造前的历史文件会额外删除其磁盘副本）
 *
 * 数据流：
 *   HTTP（含上传的文件） -> IngestionController
 *                       -> IngestionService（文件二进制直接入库、触发后台索引流水线）
 *                       -> PrismaService 与 @mini-rag/core（解析/切块/embedding/Chroma）
 *
 * 小白概念（文件上传相关）：
 *   - 文件上传用的是 multipart/form-data 格式，NestJS 借助 multer 中间件处理。
 *   - @UseInterceptors(FileInterceptor('file', {...})) 表示：
 *       拦截请求，把表单中名为 file 的那一个文件解析出来，挂到 @UploadedFile() 参数上。
 *   - storage: memoryStorage() 表示文件先存在内存里（file.buffer），不落临时盘，
 *       之后由 Service 直接把 buffer 存进数据库 Document.content（BLOB），不写本地目录。
 *   - limits.fileSize 限制文件大小，这里是 10 MB（10 * 1024 * 1024 字节）。
 *   - fileFilter 按“原始文件名后缀”过滤，只放行 pdf/doc/docx/txt/md/markdown。
 *   - 如果没带文件或后缀不允许，file 会是空的，这里手动抛 BadRequestException（400）。
 */
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { IngestionService } from './ingestion.service.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import type { AuthUser } from '../common/authenticated-request.js'

/**
 * 文档摄入控制器：文件上传入口 + 文档/切块的查询与删除。
 */
@Controller('knowledge-bases/:knowledgeBaseId/documents')
export class IngestionController {
  // 构造函数注入文档业务服务。
  constructor(@Inject(IngestionService) private readonly service: IngestionService) {}

  /**
   * 上传文档到指定知识库。
   *
   * FileInterceptor 配置说明：
   *   - 表单字段名固定为 'file'；
   *   - 使用内存存储，文件内容随后可通过 file.buffer 拿到 Buffer；
   *   - 大小上限 10MB；
   *   - fileFilter 用正则校验后缀，不匹配的文件不会被接收。
   *
   * @param id   路径参数 knowledgeBaseId：文档要归属的知识库 id。
   * @param file 上传的文件对象（multer 解析，含 originalname/mimetype/buffer 等）。
   * @returns 新创建的文档数据库记录（此时索引可能还在后台进行，状态为 PENDING/PROCESSING）。
   * @throws {BadRequestException} 当没有上传文件或文件类型不被支持时返回 400。
   * @throws {NotFoundException} 当知识库 id 不存在时由 Service 抛出 404。
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // 文件先放内存，Service 直接把二进制 buffer 存入数据库，不写任何本地目录。
      storage: memoryStorage(),
      // 限制最大 10MB，防止超大文件撑爆内存或拖慢解析。
      limits: { fileSize: 10 * 1024 * 1024 },
      // 只允许常见文档类型；正则末尾 i 表示忽略大小写（.PDF 也能通过）。
      // callback(null, true/false)：第二个参数表示是否接受该文件。
      fileFilter: (_req, file, callback) =>
        callback(null, /\.(pdf|doc|docx|txt|md|markdown)$/i.test(file.originalname)),
    }),
  )
  upload(
    @Param('knowledgeBaseId') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    // 没传文件，或后缀被 fileFilter 拒绝时，file 为 undefined，给前端明确的 400 提示。
    if (!file)
      throw new BadRequestException('Only PDF, DOC, DOCX, TXT and Markdown files are supported')
    return this.service.upload(id, file, user.id)
  }

  /**
   * 查询某个知识库下的全部文档（含各自的处理状态，供前端轮询展示）。
   * @param id 路径参数 knowledgeBaseId。
   * @param user 当前登录用户，Service 会校验该知识库归属。
   * @returns 文档记录数组，按创建时间倒序。
   */
  @Get() list(@Param('knowledgeBaseId') id: string, @CurrentUser() user: AuthUser) {
    return this.service.list(id, user.id)
  }

  /**
   * 查询某个文档切分后的全部文本块。
   * @param id 路径参数 documentId。
   * @param user 当前登录用户，Service 会校验该文档归属。
   * @returns 切块数组，按 chunkIndex（块序号）升序，方便前端按阅读顺序展示。
   */
  @Get(':documentId/chunks') chunks(
    @Param('documentId') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.chunks(id, user.id)
  }

  /**
   * 删除某个文档。
   * @param id 路径参数 documentId。
   * @param user 当前登录用户，只能删除自己知识库下的文档。
   * @returns 形如 { id } 的删除结果；文档不存在或不属于当前用户时抛 NotFoundException（404）。
   */
  @Delete(':documentId') remove(@Param('documentId') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id)
  }
}
