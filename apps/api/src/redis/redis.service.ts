/**
 * @file apps/api/src/redis/redis.service.ts
 * @description Redis 客户端服务：对 ioredis 的薄封装，是全项目访问 Redis 的唯一入口。
 *
 * 小白导读：
 * - Redis 是一个独立的内存键值数据库服务（由 docker-compose 里的 redis 容器启动），
 *   Node 程序通过 ioredis 这个库连上它，用法类似远程的“超级记事本”：set/get/exists。
 * - 本类在应用启动时建立一条连接单例，全应用复用；应用关闭时主动断开。
 * - 本项目当前用 Redis 做一件事：保存“已退出登录的 JWT 令牌黑名单”（见 AuthService）。
 *
 * 连接可靠性说明：
 * - ioredis 默认“懒重连”：Redis 容器暂时没启动或重启时，命令会等待/重试而不是立刻崩溃。
 * - retryStrategy 控制重连节奏：第 1 次等 200ms、第 2 次 400ms……最长 2 秒封顶。
 * - maxRetriesPerRequest: 3：单条命令最多内部重试 3 次，仍失败就让命令报错
 *   （守卫会因此返回 401/500，而不是把请求无限挂住）。
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { Redis } from 'ioredis'

// Redis 键名统一前缀：用“业务:用途:标识”的风格，便于在 redis-cli 里分类排查。
// 例如 auth:blacklist:e3b0c4... 表示认证模块的黑名单条目。
export const REDIS_KEYS = {
  // 令牌黑名单：后面拼令牌内容的 sha256 哈希（不直接把完整 JWT 当 key）。
  tokenBlacklist: (tokenHash: string) => `auth:blacklist:${tokenHash}`,
} as const

@Injectable()
export class RedisService implements OnModuleDestroy {
  // ioredis 客户端实例；private 外部只能通过下面封装好的方法操作，避免被随意乱用。
  private readonly client: Redis

  constructor() {
    // 连接地址来自环境变量 REDIS_URL，未配置时回退到本机默认端口。
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      // 每条命令的最大内部重试次数，防止 Redis 故障时请求被无限等待。
      maxRetriesPerRequest: 3,
      // 断线重连策略：times 是第几次重连，返回值是等待毫秒数；2000ms 封顶。
      retryStrategy: times => Math.min(times * 200, 2000),
    })
    // 连接/运行中的错误只打印日志，不抛出崩溃（ioredis 会继续按 retryStrategy 重连）。
    this.client.on('error', error => {
      console.error(`[redis] 连接异常：${error.message}`)
    })
  }

  /**
   * 写入一个带过期时间的字符串键值对（本项目用于写入黑名单）。
   * @param key 键名
   * @param value 键值（黑名单场景只需要占位的 '1'）
   * @param ttlSeconds 存活秒数；到期后 Redis 自动删除该键，无需人工清理
   */
  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    // 第三个参数 'EX' 是 Redis SET 命令的过期时间单位（秒 = EX, 毫秒 = PX）。
    await this.client.set(key, value, 'EX', ttlSeconds)
  }

  /**
   * 判断某个键是否存在（本项目用于判断令牌是否已被加入黑名单）。
   * @param key 键名
   * @returns true=存在（已拉黑）；false=不存在（正常令牌）
   */
  async exists(key: string): Promise<boolean> {
    // Redis EXISTS 命令返回整数：1 存在、0 不存在。
    return (await this.client.exists(key)) === 1
  }

  /** 应用关闭时优雅断开 Redis 连接；quit 失败也不影响进程退出。 */
  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined)
  }
}
