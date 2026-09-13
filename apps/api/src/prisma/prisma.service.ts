/**
 * @file apps/api/src/prisma/prisma.service.ts
 * @description 对 Prisma Client 的薄封装，是全项目访问数据库的统一入口。
 *
 * 小白导读：
 * - extends PrismaClient：继承后本类天然拥有 knowledgeBase、document 等数据访问方法
 *   （这些方法由 `prisma generate` 根据 schema.prisma 自动生成）。
 * - 借助 Nest 的生命周期钩子，在应用“启动完成时”连接数据库、在“关闭时”断开连接，
 *   避免连接泄漏。业务服务通过依赖注入拿到它的同一个单例。
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

// @Injectable()：声明这是一个可被 Nest 容器管理和注入的服务。
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // 模块初始化时触发：建立到 SQLite（DATABASE_URL 指定）的数据库连接。
  async onModuleInit() {
    await this.$connect()
  }

  // 应用关闭时触发：优雅断开连接，释放底层资源。
  async onModuleDestroy() {
    await this.$disconnect()
  }
}
