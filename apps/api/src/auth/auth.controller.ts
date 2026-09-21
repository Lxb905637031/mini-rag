/**
 * @file apps/api/src/auth/auth.controller.ts
 * @description 认证相关 HTTP 接口入口。
 *
 * 路由表：
 *   POST /auth/register 注册（公开接口，@Public 放行；注册成功即返回令牌）
 *   POST /auth/login    登录（公开接口，@Public 放行）
 *   GET  /auth/profile  查询当前登录用户资料（需要令牌）
 *   POST /auth/logout   退出登录（需要令牌；把令牌拉黑）
 *
 * 数据流：HTTP 请求 -> JwtAuthGuard（除 register/login 外先验令牌）
 *                 -> AuthController（收参）
 *                 -> AuthService（业务逻辑）-> Prisma / Redis / JWT
 *                 -> 全局响应拦截器统一包装成 { success, code, data, ... }
 */
import { Body, Controller, Get, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service.js'
import { LoginDto } from './dto/login.dto.js'
import { RegisterDto } from './dto/register.dto.js'
import { Public } from './decorators/public.decorator.js'
import { CurrentUser } from './decorators/current-user.decorator.js'
import type { AuthUser } from '../common/authenticated-request.js'

@Controller('auth')
export class AuthController {
  // 注入认证业务服务。
  constructor(@Inject(AuthService) private readonly service: AuthService) {}

  /**
   * 注册接口：创建新账号并直接返回访问令牌（注册即登录）。
   * @Public() 放行：未登录的用户必须能访问注册接口，否则形成死循环。
   * @param body 已通过 RegisterDto 校验的 { username, password, displayName? }
   */
  @Public()
  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.service.register(body.username, body.password, body.displayName)
  }

  /**
   * 登录接口：用户名密码换访问令牌。
   * @Public() 表示无需登录即可访问，否则会被全局守卫拦成“先登录才能登录”的死循环。
   * @param body 已通过 LoginDto 校验的 { username, password }
   */
  @Public()
  @Post('login')
  login(@Body() body: LoginDto) {
    return this.service.login(body.username, body.password)
  }

  /**
   * 查询当前登录用户资料：前端启动/刷新时用它确认令牌是否仍有效并恢复用户信息。
   * @param user 守卫挂到请求上的当前用户（id/username）
   */
  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.service.profile(user.id)
  }

  /**
   * 退出登录：把本次请求携带的令牌加入 Redis 黑名单。
   * @param authHeader Authorization 请求头，形如 "Bearer xxx.yyy.zzz"
   */
  @Post('logout')
  logout(@Headers('authorization') authHeader?: string) {
    // 守卫能走到这里说明一定带了合法 Bearer 头；没有则视为请求异常。
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少登录令牌')
    }
    const token = authHeader.slice('Bearer '.length).trim()
    return this.service.logout(token).then(() => ({ success: true }))
  }
}
