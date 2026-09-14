/**
 * @file apps/api/src/chat/chat.controller.ts
 * @description “对话问答”的 HTTP 入口：接收用户问题，交给 ChatService 完成检索+生成。
 *
 * 路由表：
 * - POST /chat/query   提交一次问答请求
 *
 * 数据流：前端请求 → 全局 ValidationPipe 按 QueryDto 校验请求体 → 本控制器 → ChatService
 *         →（向量库 / BM25 / 大模型）→ 统一响应拦截器包装返回。
 *
 * 小白导读：
 * - DTO（Data Transfer Object，数据传输对象）：用 class + 校验装饰器描述“请求体必须长什么样”，
 *   不合法的请求会在进入业务代码前就被拦下（返回 400）。
 */
import { Body, Controller, Inject, Post } from '@nestjs/common'
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator'
import { ChatService } from './chat.service.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import type { AuthUser } from '../common/authenticated-request.js'

/** POST /chat/query 的请求体结构与校验规则。 */
class QueryDto {
  // 必须是非空字符串：要在哪个知识库中提问。
  @IsString()
  @IsNotEmpty()
  knowledgeBaseId!: string

  // 必须是非空字符串：用户的问题内容。
  @IsString()
  @IsNotEmpty()
  query!: string

  // 可选项；若提供，只能是三种检索模式之一，其它值直接校验失败。
  @IsOptional()
  @IsIn(['vector', 'bm25', 'hybrid'])
  mode?: 'vector' | 'bm25' | 'hybrid'

  // 可选项；返回片段数量，范围 1~20，防止一次索取过多片段。
  @IsOptional()
  @Min(1)
  @Max(20)
  topK?: number

  // 可选项；是否对初筛结果再做一次重排（true/false）。
  @IsOptional()
  @IsBoolean()
  rerank?: boolean
}

// 本控制器的路由统一以 /chat 开头。
@Controller('chat')
export class ChatController {
  // 依赖注入：Nest 在创建控制器时把 ChatService 单例传进来，类内不自己 new。
  constructor(@Inject(ChatService) private readonly service: ChatService) {}

  // POST /chat/query；@Body() 把请求体解析为 QueryDto（已通过全局管道校验与类型转换）。
  @Post('query')
  query(@Body() body: QueryDto, @CurrentUser() user: AuthUser) {
    // 控制器保持“薄”：把问题与当前用户 id 一起转交服务层，
    // 服务层会据此限制只能检索当前用户自己的知识库。
    return this.service.query(body, user.id)
  }
}
