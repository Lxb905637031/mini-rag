/**
 * @file apps/api/src/auth/decorators/current-user.decorator.ts
 * @description @CurrentUser() 参数装饰器：在控制器方法里直接拿到“当前登录用户”。
 *
 * 使用示例：
 *   @Get('profile')
 *   profile(@CurrentUser() user: AuthUser) { ... }
 *
 * 小白导读：
 * - JwtAuthGuard 校验通过后已经把用户信息挂到了 req.user 上；
 * - 这个装饰器只是帮你从请求对象里把 user 取出来，省得每个方法都写 @Req() 再 .user。
 * - createParamDecorator 是 NestJS 提供的“参数装饰器工厂”，回调里能拿到执行上下文，
 *   进而取出底层的 Express 请求对象。
 */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { AuthenticatedRequest, AuthUser } from '../../common/authenticated-request.js'

// createParamDecorator 的泛型参数表示“取出来的值类型”。
// data 是使用装饰器时传入的参数（本装饰器不需要，所以用 _ 忽略）。
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined => {
    // 切换到 HTTP 上下文，取出 Express 请求对象（它上面有守卫写入的 user）。
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    return request.user
  },
)
