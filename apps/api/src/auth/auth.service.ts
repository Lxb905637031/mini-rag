/**
 * @file apps/api/src/auth/auth.service.ts
 * @description 认证业务服务：登录验密签发 JWT、查询当前用户资料、退出登录写入 Redis 黑名单。
 *
 * 小白导读：
 * - 登录本质 = “核对密码 → 发一张有期限的签名令牌（JWT）”；之后浏览器拿着令牌访问，
 *   服务器不再需要查密码，只验签名。
 * - bcrypt.compare(明文, 哈希)：用同样的盐重新计算并比对，即使两个用户密码相同，
 *   由于盐不同，数据库里的哈希也不同。
 * - 退出登录 = 让这张未到期的令牌提前失效。JWT 本身无状态、收不回来，所以借助 Redis
 *   保存一份“黑名单”：守卫每次先查黑名单，命中就拒绝。
 */
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service.js'
import { RedisService, REDIS_KEYS } from '../redis/redis.service.js'

// 说明：本项目开发时用 tsx（esbuild）运行，它不会生成 design:paramtypes 元数据，
// 所以构造函数的每个依赖都必须“显式”写 @Inject(令牌)，否则运行时会注入 undefined。

/** 返回给前端的用户信息形状（刻意不含 passwordHash 等敏感字段）。 */
export interface SafeUser {
  id: string
  username: string
  displayName: string | null
  createdAt: Date
}

/** 登录成功后返回给前端的数据：访问令牌 + 用户基本资料。 */
export interface LoginResult {
  accessToken: string
  user: SafeUser
}

@Injectable()
export class AuthService {
  constructor(
    // 注入 PrismaService 操作 User 表。
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // 注入 JwtService 签发令牌。
    @Inject(JwtService) private readonly jwtService: JwtService,
    // 注入 RedisService 读写黑名单。
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * 登录：按用户名查用户并用 bcrypt 比对密码，成功则签发 JWT。
   * @param username 用户名
   * @param password 明文密码（只在内存中参与比对，绝不落库、不打日志）
   * @returns 访问令牌与用户资料
   * @throws UnauthorizedException 用户名不存在或密码错误时抛 401
   */
  async login(username: string, password: string): Promise<LoginResult> {
    // 按用户名查账号。
    const user = await this.prisma.user.findUnique({ where: { username } })
    // 用户不存在或密码比对失败都返回同一句提示，避免暴露“用户名是否存在”。
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('用户名或密码错误')
    }
    // 签发令牌：sub 约定为用户 id；有效期由 JwtModule 注册时的 expiresIn 决定。
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      username: user.username,
    })
    return { accessToken, user: this.toSafeUser(user) }
  }

  /**
   * 查询当前登录用户的资料（供前端刷新页面后恢复登录态）。
   * @param userId 守卫从 JWT 中解析出的用户 id
   * @throws UnauthorizedException 令牌里的用户已不存在（如账号被删）时抛 401
   */
  async profile(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new UnauthorizedException('用户不存在，请重新登录')
    return this.toSafeUser(user)
  }

  /**
   * 退出登录：把当前令牌加入 Redis 黑名单，TTL 与令牌剩余有效期保持一致，
   * 到期自动清理，黑名单里不会堆积无用数据。
   * @param token 原始 JWT 字符串（控制器已从 Authorization 头取出）
   */
  async logout(token: string): Promise<void> {
    // decode 只解析内容、不验签（能走到这里说明守卫已验签通过）。
    const decoded = this.jwtService.decode(token) as { exp?: number } | null
    // exp 是 Unix 秒级时间戳；剩余寿命 = 过期时刻 - 当前时刻。
    const ttlSeconds = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 0
    // 令牌本身已过期就无需拉黑（它本来就不能再用）。
    if (ttlSeconds <= 0) return
    // 用令牌哈希做黑名单键，值仅占位；EX 设置自动过期秒数。
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await this.redis.setWithTtl(REDIS_KEYS.tokenBlacklist(tokenHash), '1', ttlSeconds)
  }

  /**
   * 把 Prisma 的用户记录转换成“对外安全形状”：剔除密码哈希。
   * 集中在一个方法里做，能防止某个接口不小心把 passwordHash 返回给前端。
   */
  private toSafeUser(user: {
    id: string
    username: string
    displayName: string | null
    createdAt: Date
  }): SafeUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt,
    }
  }
}
