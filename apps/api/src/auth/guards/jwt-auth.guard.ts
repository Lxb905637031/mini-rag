/**
 * @file apps/api/src/auth/guards/jwt-auth.guard.ts
 * @description 全局 JWT 认证守卫：每个受保护接口在进入控制器前都要先过这一关。
 *
 * 一次请求的校验流程（重点理解）：
 *   1. 路由或控制器上如果标了 @Public()，直接放行（登录、健康检查接口）。
 *   2. 从请求头 Authorization: Bearer <令牌> 中取出 JWT。
 *   3. 用 JWT_SECRET 验证签名和有效期：签名不对/已过期 → 401。
 *   4. 到 Redis 查“令牌黑名单”：用户退出登录后，其令牌会被拉黑到自然过期 → 401。
 *   5. 全部通过：把 { id, username } 挂到 req.user，放行进入控制器。
 *
 * 小白概念：
 * - 守卫（Guard）：NestJS 请求生命周期中介于中间件和拦截器之间的一环，
 *   返回 true 放行，抛异常/返回 false 则拒绝（我们这里拒绝时抛 UnauthorizedException=401）。
 * - JWT（JSON Web Token）：登录成功后服务器签发的一张“签名通行证”，
 *   内容是 { sub: 用户id, username } 加过期时间，防篡改但不加密，不要放敏感信息。
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
// Reflector 用于读取 @Public() 写入的路由元数据，它由 @nestjs/core 提供（不是 common）。
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { createHash } from 'node:crypto'
import type { AuthenticatedRequest, AuthUser } from '../../common/authenticated-request.js'
import { RedisService, REDIS_KEYS } from '../../redis/redis.service.js'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js'

/** JWT 解析出来的载荷结构（只声明我们会用到的字段）。 */
interface JwtPayload {
  // subject 的缩写，约定放用户 id。
  sub: string
  username: string
  // 角色（RBAC）：登录签发时写入，RolesGuard 据此鉴权。
  role?: string
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  // 注入：Reflector 用来读取路由上的 @Public() 元数据；
  // JwtService 用来验签；RedisService 用来查黑名单。
  // 同样全部显式 @Inject——兼容 tsx(esbuild) 不生成参数类型元数据的情况。
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * 守卫入口：返回 true 放行，否则抛 401 异常（由全局异常过滤器统一包装成错误 JSON）。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // getAllAndOverride：优先读“方法上”的元数据，没有再读“控制器类上”的。
    // 这样类上标了 @Public() 整体放行，单个方法也可以单独标记。
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    // 公开接口（如登录、健康检查）不需要令牌，直接放行。
    if (isPublic) return true

    // 取出底层 Express 请求。
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    // 按 HTTP 标准，令牌放在 Authorization 请求头，格式为 "Bearer xxx.yyy.zzz"。
    const authHeader = request.headers.authorization
    // 没带头或格式不对：视为未登录。
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('未登录或登录已失效，请先登录')
    }
    // 去掉前缀并去掉两端空白，得到纯令牌字符串。
    const token = authHeader.slice('Bearer '.length).trim()

    // 验证签名与有效期。verifyAsync 会在签名错误、令牌过期等情况下抛异常。
    let payload: JwtPayload
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token)
    } catch {
      throw new UnauthorizedException('登录已失效，请重新登录')
    }

    // 查 Redis 黑名单：黑名单的 key 用令牌的 sha256 哈希，避免把完整 JWT 直接当键。
    const tokenHash = createHash('sha256').update(token).digest('hex')
    if (await this.redis.exists(REDIS_KEYS.tokenBlacklist(tokenHash))) {
      throw new UnauthorizedException('登录状态已退出，请重新登录')
    }

    // 校验通过：把当前用户信息挂到请求对象上，后续控制器用 @CurrentUser() 读取。
    // role 一并透传，供 RolesGuard 鉴权（没带 role 的旧令牌为 undefined，鉴权时会 403）。
    const user: AuthUser = { id: payload.sub, username: payload.username, role: payload.role }
    request.user = user
    return true
  }
}
