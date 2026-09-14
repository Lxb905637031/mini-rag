/**
 * @file apps/api/src/redis/redis.module.ts
 * @description Redis 能力的 NestJS 模块（与 PrismaModule 一样注册为全局模块）。
 *
 * 小白导读：
 * - @Global() 表示全应用只需注册一次，其它模块（如 AuthModule）直接注入 RedisService 即可，
 *   不用在每个模块的 imports 里重复引入。
 * - providers：由 Nest 容器创建的服务；exports：允许其它模块注入同一个单例。
 */
import { Global, Module } from '@nestjs/common'
import { RedisService } from './redis.service.js'

// 全局模块：提供并导出 RedisService 单例。
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
