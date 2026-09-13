/**
 * @file apps/api/src/common/api-response.interceptor.ts
 * @description 全局响应拦截器：把每个控制器的返回值统一包装成固定外壳，
 *              并为每次请求生成 requestId、记录访问日志与耗时。
 *
 * 统一成功响应结构：
 *   { success:true, code:'OK', message:'请求成功', data:<控制器返回值>, meta:{...} }
 *
 * 小白导读：
 * - 拦截器（Interceptor）夹在“路由处理前后”之间：控制器正常返回后，map 会对结果做最后加工。
 * - 控制器因此只需关心业务数据，统一外壳、日志、请求 id 等横切逻辑集中在这里。
 * - 它和异常过滤器是一对：成功走拦截器，失败走过滤器，但两者响应结构保持一致。
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
// RxJS：Nest 用 Observable 流表示“控制器未来的返回值”，pipe/map 用于在值产出时加工。
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  /**
   * @param context 执行上下文，可取出底层 Express 请求/响应
   * @param next 调用 next.handle() 才会继续执行后面的控制器；其返回值是响应数据流
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string
      originalUrl?: string
      url: string
      headers: Record<string, string | string[] | undefined>
    }>()
    const response = context.switchToHttp().getResponse<{
      statusCode: number
      setHeader: (name: string, value: string) => void
    }>()

    // 与异常过滤器相同的 requestId 规则：沿用请求头传入的，否则生成 UUID。
    const requestId =
      typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : randomUUID()
    // 请求开始时间戳。
    const startedAt = Date.now()
    // 挂到 request 对象上：万一后续抛错，异常过滤器能读到它并算出耗时。
    ;(request as { __apiStartedAt?: number }).__apiStartedAt = startedAt
    // 响应头回传 requestId，方便前端/抓包工具关联。
    response.setHeader('x-request-id', requestId)

    // next.handle() 代表控制器的（未来）返回值；map 在它 resolve 后统一包装。
    return next.handle().pipe(
      map(data => {
        // 本次请求实际耗时（毫秒）。
        const durationMs = Date.now() - startedAt
        // 公共元信息。
        const meta = {
          requestId,
          timestamp: new Date().toISOString(),
          path: request.originalUrl ?? request.url,
          durationMs,
        }
        // 结构化访问日志（一行 JSON，方便日后采集检索）。
        console.info(
          JSON.stringify({
            type: 'api.response',
            method: request.method,
            status: response.statusCode,
            ...meta,
          }),
        )
        // 统一成功外壳；data 为 undefined 时归一化为 null（JSON 里没有 undefined）。
        return {
          success: true,
          code: 'OK',
          message: '请求成功',
          data: data ?? null,
          meta,
        }
      }),
    )
  }
}
