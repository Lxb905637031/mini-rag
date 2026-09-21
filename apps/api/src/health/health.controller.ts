/**
 * @file apps/api/src/health/health.controller.ts
 * @description 健康检查接口，用于运维或前端确认“后端活着、依赖地址是什么”。
 *
 * 路由：GET /health
 * 小白导读：Controller（控制器）只负责接收 HTTP 请求并返回响应，不含复杂业务。
 */
import { Controller, Get, Inject } from '@nestjs/common'
import { loadConfig } from '@mini-rag/core'
import { Public } from '../auth/decorators/public.decorator.js'
// 队列单例：健康检查时顺带汇报“队列里还有多少任务”，自愈/积压情况一眼可见。
import { IngestionQueue } from '../ingestion/ingestion.queue.js'

// @Controller('health') 表示本类所有路由都以 /health 开头。
// @Public() 标记健康检查为公开接口：未登录（包括部署探活）也能访问。
@Public()
@Controller('health')
export class HealthController {
  // 注入文档索引队列：用 getJobCounts() 读取队列的实时统计。
  constructor(@Inject(IngestionQueue) private readonly queue: IngestionQueue) {}

  // @Get() 映射 GET /health 请求到这个方法。
  // 注意：必须是真正的 @Get() 装饰器（不能只写在注释里），Nest 才会注册这条路由。
  // 改为 async：方法内部要 await 队列计数（一次 Redis 查询，开销极小）。
  @Get()
  async check() {
    // 读取核心库配置，把关键依赖的访问地址一并返回，方便排查“连不上哪个服务”。
    const config = loadConfig()
    // 读取队列实时统计：waiting 排队中 / active 处理中 / delayed 等待重试 / failed 重试耗尽。
    // 用 .catch(() => null) 兜底：Redis 没启动等情况下返回 null，
    // 保证健康检查本身不被队列依赖拖垮（探活永远要能返回）。
    const queue = await this.queue
      .getJobCounts('waiting', 'active', 'delayed', 'failed')
      .catch(() => null)
    return {
      // ok：API 进程本身可响应。
      ok: true,
      // services：列出外部依赖的目标地址（这里只回显地址，不做真实探活）。
      services: {
        ollama: config.ollamaBaseUrl, // 本地大模型/嵌入服务
        chroma: config.chromaUrl, // 向量数据库
        database: 'postgresql', // 业务数据库：2026-09-20 起由 SQLite 迁移到 PostgreSQL
      },
      // queue：文档索引队列的实时统计（Redis 不可用时为 null）。
      // 用途：启动自愈后能看到 waiting 从 N 个逐渐消化的过程，闭环可观测。
      queue,
    }
  }
}
