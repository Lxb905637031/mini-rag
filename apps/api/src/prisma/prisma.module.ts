/**
 * @file apps/api/src/prisma/prisma.module.ts
 * @description Prisma（数据库访问层）的 NestJS 模块。
 *
 * 小白导读：
 * - Prisma 是一个 ORM（对象关系映射）工具：让我们用 this.prisma.xxx 的 JavaScript 方法
 *   操作 SQLite 数据库，而不用手写 SQL。
 * - 本模块把 PrismaService 注册为“全局可用”，这样其它业务模块（知识库、文档、对话……）
 *   无需在各自的 @Module 里反复 imports PrismaModule，直接注入 PrismaService 即可。
 * - providers：本模块内部“生产”哪些服务；exports：把哪些服务开放给别的模块使用。
 */
import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service.js'

// @Global() 让本模块在整个应用中只注册一次、处处可注入。
// providers 声明服务实例由 Nest 容器创建，exports 表示允许其它模块注入同一个单例。
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
// 类体为空：它只承担“装配/开关”的角色，本身没有逻辑。
export class PrismaModule {}
