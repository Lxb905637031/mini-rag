/**
 * @file apps/api/src/auth/guards/roles.guard.ts
 * @description 角色守卫（RBAC 的执行要素）：检查当前用户角色是否满足接口要求。
 *
 * 与 JwtAuthGuard 的分工（认证/鉴权分离）：
 *   - JwtAuthGuard：认证——「你是谁」。验签 + 查黑名单，把 { id, username, role }
 *     挂到 req.user。失败抛 401（不知道你是谁）。
 *   - RolesGuard：鉴权——「你能干什么」。读 @Roles 元数据，对照 req.user.role。
 *     失败抛 403（知道你是谁，但你不能这么干）。
 *
 * 执行顺序（关键）：两个守卫都以 APP_GUARD 注册为全局，按注册顺序执行——
 *   必须先 JwtAuthGuard（生产 req.user）再 RolesGuard（消费 req.user）。
 *   顺序反了会导致 req.user 尚不存在，所有人（包括 admin）都被 403。
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { AuthenticatedRequest } from '../../common/authenticated-request.js'
import { ROLES_KEY } from '../decorators/roles.decorator.js'

@Injectable()
export class RolesGuard implements CanActivate {
  // 显式 @Inject：tsx(esbuild) 不生成参数类型元数据（阶段 1 反复强调的坑）。
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  /**
   * 角色检查入口：返回 true 放行；角色不满足抛 403。
   */
  canActivate(context: ExecutionContext): boolean {
    // 读 @Roles(...) 写入的元数据；先查方法级再查类级（与 @Public 同一套机制），
    // 因此整个控制器可以类级限角色，个别方法再单独放宽/收紧。
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    // 没标 @Roles = 不限制角色，直接放行——本守卫只管角色，登录校验是 JwtAuthGuard 的事。
    if (!required || required.length === 0) return true

    // 走到这里时 JwtAuthGuard 必已执行（注册顺序在前），req.user 一定有值。
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const role = request.user?.role
    // 未携带角色（旧令牌）或角色不在白名单里，一律 403。
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('当前账号角色无权访问该接口')
    }
    return true
  }
}
