/**
 * 知识库控制器（Controller 层）
 *
 * 业务职责：
 *   处理“知识库（knowledge-bases）”相关的 HTTP 请求。知识库是整个本地 RAG
 *   系统最外层的容器：一个知识库下面可以挂多个文档（documents），文档上传后
 *   会被切块、向量化并写入向量数据库 Chroma，之后才能用于问答。
 *
 * HTTP 路由表：
 *   GET    /knowledge-bases       查询知识库列表（附带每个库的文档数量）
 *   POST   /knowledge-bases       新建一个知识库（请求体：{ "name": "..." }）
 *   GET    /knowledge-bases/:id   按 id 查询单个知识库详情（含其全部文档）
 *   DELETE /knowledge-bases/:id   按 id 删除一个知识库
 *
 * 数据流：
 *   HTTP 请求 -> KnowledgeController（收参/校验/回参）
 *            -> KnowledgeService（业务逻辑）
 *            -> PrismaService（通过 Prisma ORM 读写 SQLite/数据库）
 *
 * 小白概念：
 *   - Controller 只负责“收参、调 Service、回参”，本身不写业务逻辑。
 *   - DTO（Data Transfer Object，数据传输对象）用来描述请求体长什么样。
 *   - class-validator 的装饰器会自动校验请求体：
 *       @IsString()  要求字段必须是字符串；
 *       @IsNotEmpty() 要求字符串不能是空串或全空白。
 *     校验不通过时 NestJS 会自动返回 400 错误，不需要手写判断。
 *   - @Controller('knowledge-bases') 声明路由前缀；@Get/@Post/@Delete 声明方法。
 *   - @Param('id') 取 URL 路径参数；@Body() 取请求体。
 *   - @Inject(...) 是 NestJS 的“依赖注入”：框架自动把 Service 实例传进来。
 */
import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common'
import { IsNotEmpty, IsString } from 'class-validator'
import { KnowledgeService } from './knowledge.service.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import type { AuthUser } from '../common/authenticated-request.js'

/**
 * 创建知识库的请求体 DTO。
 * 对应 POST /knowledge-bases，目前只需要一个字段：知识库名称。
 */
class CreateKnowledgeDto {
  // 名称必须是字符串，且不能为空；name! 中的 ! 是 TS 语法，表示“该属性必定有值”。
  @IsString() @IsNotEmpty() name!: string
}

/**
 * 知识库控制器：把四个 HTTP 端点转发给 KnowledgeService 处理。
 */
@Controller('knowledge-bases')
export class KnowledgeController {
  // 构造函数注入 KnowledgeService；private readonly 表示仅本类可用且不可重新赋值。
  constructor(@Inject(KnowledgeService) private readonly service: KnowledgeService) {}

  /**
   * 查询当前登录用户的知识库列表。
   * @param user 当前登录用户（由全局 JWT 守卫写入、@CurrentUser() 取出）
   * @returns 知识库数组，每项附带 _count.documents（该库下的文档数量），按更新时间倒序。
   */
  @Get() list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.id)
  }

  /**
   * 新建知识库（自动归属给当前登录用户）。
   * @param body 经过 DTO 校验的请求体，里面只有 name（名称）。
   * @param user 当前登录用户。
   * @returns 新创建的知识库记录（含自动生成的 id、时间戳等）。
   */
  @Post() create(@Body() body: CreateKnowledgeDto, @CurrentUser() user: AuthUser) {
    return this.service.create(body.name, user.id)
  }

  /**
   * 按 id 查询单个知识库详情（只能查自己的，包含其下全部文档）。
   * @param id 路径参数：知识库 id。
   * @param user 当前登录用户。
   * @returns 知识库详情；若 id 不存在或不属于当前用户，Service 抛 NotFoundException（404）。
   */
  @Get(':id') get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(id, user.id)
  }

  /**
   * 按 id 删除知识库（只能删自己的）。
   * @param id 路径参数：知识库 id。
   * @param user 当前登录用户。
   * @returns 被删除的知识库记录；若 id 不存在或不属于当前用户则抛 NotFoundException（404）。
   */
  @Delete(':id') remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id)
  }
}
