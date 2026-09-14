/**
 * @file apps/api/src/common/api-exception.filter.ts
 * @description 全局异常过滤器：任何控制器抛出的错误都会被这里兜底捕获，
 *              统一转换成结构一致的错误 JSON，避免把堆栈等敏感信息直接暴露给前端。
 *
 * 统一错误响应结构：
 *   { success:false, code, message, data:null, meta:{...}, error:{ type, details } }
 *
 * 小白导读：
 * - @Catch() 不带参数 = 捕获所有类型的异常（包括非 HttpException 的未知错误）。
 * - HttpException（如 NotFoundException）自带 HTTP 状态码；其它意外错误一律按 500 处理。
 * - requestId 贯穿一次请求（与响应拦截器共用同一 id），方便用户报问题时按日志定位。
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'

// 注册为“捕获一切异常”的过滤器（在 main.ts 中通过 useGlobalFilters 全局启用）。
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  /**
   * 异常统一处理入口。
   * @param exception 被抛出的原始异常（类型未知，需要自行判别）
   * @param host Nest 提供的“执行上下文”，可从中取出底层的 request/response 对象
   */
  catch(exception: unknown, host: ArgumentsHost) {
    // 切换到 HTTP 上下文，拿到 Express 的请求与响应对象。
    const http = host.switchToHttp()
    const request = http.getRequest<{
      method: string
      originalUrl?: string
      url: string
      headers: Record<string, string | string[] | undefined>
    }>()
    const response = http.getResponse<{
      status: (code: number) => { json: (body: unknown) => void }
      setHeader: (name: string, value: string) => void
    }>()

    // 请求 id：优先沿用调用方传入的 x-request-id，没有就现场生成一个 UUID。
    const requestId =
      typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : randomUUID()

    // 已知的 HTTP 异常用它自带的状态码（如 404/400）；其余未知异常一律视为 500。
    const status = exception instanceof HttpException ? exception.getStatus() : 500
    // HttpException 的响应体可能是字符串或对象（class-validator 的错误通常是 { message: [...] }）。
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined
    const rawMessage =
      typeof raw === 'object' && raw !== null && 'message' in raw ? raw.message : undefined
    // message 归一化：校验错误数组用中文分号拼成一句话；字符串直接用；
    // 普通 Error 取 message；实在没有信息就给一个通用提示。
    const message = Array.isArray(rawMessage)
      ? rawMessage.join('；')
      : typeof rawMessage === 'string'
        ? rawMessage
        : exception instanceof Error
          ? exception.message
          : '服务器内部错误'
    // 业务错误码：如果异常体里自带字符串 code 就用它，否则用 HTTP_状态码 兜底。
    const code =
      typeof raw === 'object' && raw !== null && 'code' in raw && typeof raw.code === 'string'
        ? raw.code
        : `HTTP_${status}`
    // 出错路径：优先用经过路由处理后的 originalUrl。
    const path = request.originalUrl ?? request.url
    // 若响应拦截器在请求对象上记录了开始时间，则顺带计算本次请求耗时。
    // 请求对象的基础类型里没有 __apiStartedAt 字段（由拦截器动态挂上去），
    // 所以先转 unknown 再转目标形状，这是 TS 给“动态附加字段”做类型收窄的标准写法。
    const timedRequest = request as unknown as { __apiStartedAt?: number }
    const durationMs =
      typeof timedRequest.__apiStartedAt === 'number'
        ? Date.now() - timedRequest.__apiStartedAt
        : undefined
    // 错误类型名（如 NotFoundError / TypeError），便于日志分类统计。
    const errorType = exception instanceof Error ? exception.name : 'UnknownError'
    // 结构化错误日志：打印完整异常对象，服务端排障靠它（不会原样返回给前端）。
    console.error(
      JSON.stringify({
        type: 'api.error',
        method: request.method,
        status,
        code,
        requestId,
        path,
        errorType,
        error: exception,
      }),
    )
    // 把 requestId 写回响应头，前端/网关报错时可凭此 id 找日志。
    response.setHeader('x-request-id', requestId)
    // 以正确的 HTTP 状态码返回统一结构的错误 JSON。
    response.status(status).json({
      success: false, // 统一成功标志
      code, // 错误码
      message, // 给用户看的错误描述
      data: null, // 失败时数据为空
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        path,
        // 有耗时信息才带这个字段，没有就不出现。
        ...(durationMs === undefined ? {} : { durationMs }),
      },
      error: { type: errorType, details: message },
    })
  }
}
