/**
 * 知识库服务（Service 层）
 *
 * 业务职责：
 *   承载“知识库”的全部业务逻辑：列表查询、创建、详情查询、删除。
 *   Controller 不直接操作数据库，而是调用这里的方法。
 *
 * 数据流：
 *   KnowledgeController -> KnowledgeService（本类）
 *                      -> PrismaService -> Prisma ORM -> 数据库
 *
 * 小白概念：
 *   - @Injectable() 表示这是一个可被 NestJS 依赖注入容器管理的服务，
 *     其他类（如 Controller）就可以在构造函数里注入它。
 *   - Prisma 是一个 ORM（对象关系映射工具）：用 this.prisma.knowledgeBase.xxx()
 *     这样的 JS 方法来操作 knowledgeBase 数据表，不用手写 SQL。
 *   - 常用查询参数：
 *       include  关联查询，把相关的子表数据一起带出来；
 *       _count   只统计关联记录的“数量”而不把内容全部取出（性能更好）；
 *       orderBy  排序；where 过滤条件；data 写入的数据。
 *   - NotFoundException 是 NestJS 内置异常，抛出后框架会自动返回 HTTP 404。
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'

/**
 * 知识库业务服务。所有对 knowledgeBase 表的增删查都集中在这里。
 */
@Injectable()
export class KnowledgeService {
  // 注入 PrismaService，拿到 this.prisma 作为操作数据库的统一入口。
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 查询当前登录用户的全部知识库（用于首页列表展示）。
   * @param ownerId 当前登录用户 id（由控制器从 JWT 守卫注入）
   * @returns 知识库数组；每项额外带 _count.documents（文档数量），按 updatedAt 倒序。
   */
  list(ownerId: string) {
    return this.prisma.knowledgeBase.findMany({
      // where 加上归属过滤：每个用户只能看到自己的知识库（数据隔离的关键）。
      where: { ownerId },
      // include + _count：只带出关联文档的“条数”，避免把文档内容全部查出来。
      include: { _count: { select: { documents: true } } },
      // 最近更新的知识库排在最前面。
      orderBy: { updatedAt: 'desc' },
    })
  }

  /**
   * 创建一个归属于当前用户的新知识库。
   * @param name 知识库名称（已由 Controller 层的 DTO 校验为非空字符串）。
   * @param ownerId 当前登录用户 id。
   * @returns 新创建的知识库记录（Prisma 会自动填充 id、createdAt、updatedAt）。
   */
  async create(name: string, ownerId: string) {
    return this.prisma.knowledgeBase.create({ data: { name, ownerId } })
  }

  /**
   * 按 id 查询单个知识库（必须属于当前用户），同时带出它的全部文档。
   * @param id 知识库 id。
   * @param ownerId 当前登录用户 id。
   * @returns 知识库记录（documents 字段为其下的文档数组）。
   * @throws {NotFoundException} 当 id 不存在、或不属于当前用户时抛出 404。
   *         统一返回 404 而不是 403，可以避免泄露“别人的资源确实存在”。
   */
  async get(id: string, ownerId: string) {
    const item = await this.prisma.knowledgeBase.findFirst({
      // findFirst + 复合条件：id 与归属人必须同时匹配，查别人的库就像不存在一样。
      where: { id, ownerId },
      // 详情页需要展示文档清单，所以这里把关联的 documents 完整带出。
      include: { documents: true },
    })
    // 查不到说明 id 非法、已被删除、或属于其他用户，统一抛 404。
    if (!item) throw new NotFoundException('Knowledge base not found')
    return item
  }

  /**
   * 按 id 删除知识库（只能删自己的）。
   * @param id 知识库 id。
   * @param ownerId 当前登录用户 id。
   * @returns 被删除的知识库记录。
   * @throws {NotFoundException} 先调用 this.get(id, ownerId) 做归属校验，不通过抛 404。
   */
  async remove(id: string, ownerId: string) {
    // 先查一次（含归属校验）：不存在或不属于自己都直接抛 404。
    await this.get(id, ownerId)
    // 能走到这里说明该库确定属于当前用户，可以安全删除。
    return this.prisma.knowledgeBase.delete({ where: { id } })
  }
}
