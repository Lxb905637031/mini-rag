/**
 * @file apps/api/src/health/health.controller.ts
 * @description 健康检查接口，用于运维或前端确认“后端活着、依赖地址是什么”。
 *
 * 路由：GET /health
 * 小白导读：Controller（控制器）只负责接收 HTTP 请求并返回响应，不含复杂业务。
 */
import { Controller, Get } from '@nestjs/common'
import { loadConfig } from '@mini-rag/core'
import { Public } from '../auth/decorators/public.decorator.js'

// @Controller('health') 表示本类所有路由都以 /health 开头。
// @Public() 标记健康检查为公开接口：未登录（包括部署探活）也能访问。
@Public()
@Controller('health')
export class HealthController {
  // @Get() 映射 GET /health 请求到这个方法。
  // 注意：必须是真正的 @Get() 装饰器（不能只写在注释里），Nest 才会注册这条路由。
  @Get()
  check() {
    // 读取核心库配置，把关键依赖的访问地址一并返回，方便排查“连不上哪个服务”。
    const config = loadConfig()
    return {
      // ok：API 进程本身可响应。
      ok: true,
      // services：列出外部依赖的目标地址（这里只回显地址，不做真实探活）。
      services: {
        ollama: config.ollamaBaseUrl, // 本地大模型/嵌入服务
        chroma: config.chromaUrl, // 向量数据库
        database: 'sqlite', // 业务数据库固定为 SQLite
      },
    }
  }
}
