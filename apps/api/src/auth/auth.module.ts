/**
 * @file apps/api/src/auth/auth.module.ts
 * @description 认证模块：装配控制器、服务、JWT，并注册“全局 JWT 守卫”。
 *
 * 小白导读：
 * - JwtModule.register 配置签名密钥与有效期，global: true 让 JwtService 在各模块可直接注入。
 * - providers 里通过 APP_GUARD 注册的守卫会自动应用到“全局所有路由”：
 *     默认全部需要登录，只有标了 @Public() 的路由例外。这比给每个控制器逐个加守卫
 *     更不容易漏（新增接口默认就是受保护的）。
 * - RedisModule 是全局模块，AuthService/JwtAuthGuard 可直接注入 RedisService。
 */
import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { JwtAuthGuard } from './guards/jwt-auth.guard.js'
import { RolesGuard } from './guards/roles.guard.js'

@Module({
  imports: [
    // 注册 JWT 能力：secret 是签名密钥（务必来自环境变量），expiresIn 是令牌有效期。
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'mini-rag-dev-only-secret',
      // 形如 '1d' 的有效期字符串符合 jsonwebtoken 的写法（ms 库时间格式）；
      // 当前 .env 里配置为 1d（一天）；这里没配到环境变量时兜底 1h，避免误用超长有效期。
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '1h') as any },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // 以 APP_GUARD 令牌注册：告诉 Nest 把 JwtAuthGuard 作为全局守卫启用。
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 第二个全局守卫：角色鉴权。注册顺序即执行顺序——
    // 先 JwtAuthGuard（认证，生产 req.user），后 RolesGuard（鉴权，消费 req.user.role）。
    // 顺序颠倒会导致 req.user 尚不存在，所有人（含 admin）都被 403。
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
