/**
 * @file apps/api/prisma/seed.ts
 * @description 数据库种子脚本：向数据库写入“初始数据”。
 *
 * 本项目目前只做两件事：
 *   1. 确保存在一个管理员账号（用户名/密码来自环境变量 ADMIN_USERNAME / ADMIN_PASSWORD），
 *      这样你第一次打开登录页就有账号可用，不需要注册功能。
 *   2. 把“迁移之前就已经存在、还没有归属人（ownerId 为空）”的历史知识库，
 *      统一回填给这个管理员，避免登录后看不到旧数据。
 *
 * 运行方式（在 apps/api 目录下，由根目录 package.json 的 db:seed 脚本封装）：
 *   pnpm exec prisma db seed
 * Prisma 会按 package.json 里 "prisma.seed" 的配置，用 tsx 执行本文件；
 * 同时 Prisma CLI 会自动加载 apps/api/.env，所以脚本能读到 DATABASE_URL 和管理员配置。
 *
 * 小白概念：
 *   - “种子（seed）”= 数据库初始化时第一批被种进去的数据，可重复执行。
 *   - upsert 思想（这里手写实现）：存在就跳过/更新，不存在才创建，保证脚本反复跑不报错。
 *   - bcrypt.hash(明文, 10)：加盐哈希 10 轮；数字越大越安全但越慢，10 是常用值。
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

// PrismaClient 是操作数据库的入口（与 Nest 运行时里的 PrismaService 同源）。
const prisma = new PrismaClient()

/**
 * 种子主流程：创建管理员并回填历史知识库。
 * async 函数：数据库操作都是异步的，需要 await 等待结果。
 */
async function main() {
  // 管理员账号配置：优先读环境变量，未配置时给出仅适合本地开发的兜底值。
  // 生产/公网部署时务必在 .env 中改成自己的强密码！
  const username = process.env.ADMIN_USERNAME ?? 'admin'
  const password = process.env.ADMIN_PASSWORD ?? 'admin123'

  // 先按用户名查一下，判断管理员是否已经存在。
  const existing = await prisma.user.findUnique({ where: { username } })

  // 已存在：不覆盖密码（用户登录后若修改过密码，重复跑种子也不会把密码冲掉）。
  // 不存在：用 bcrypt 生成密码哈希后创建新用户，昵称默认等于用户名。
  const admin = existing
    ? existing
    : await prisma.user.create({
        data: {
          username,
          // 数据库只存哈希，永远不存明文密码；哈希无法反推出原密码。
          passwordHash: await bcrypt.hash(password, 10),
          displayName: username,
        },
      })

  // 批量回填：把所有 ownerId 还为空的知识库挂到管理员名下。
  // updateMany 只更新符合 where 条件的行；count 是实际被更新的行数。
  const backfilled = await prisma.knowledgeBase.updateMany({
    where: { ownerId: null },
    data: { ownerId: admin.id },
  })

  // 打印执行结果，方便在终端确认种子是否生效。
  console.log(
    [
      existing ? `管理员已存在：${username}（保留现有密码）` : `已创建管理员：${username}`,
      `回填历史知识库 ${backfilled.count} 个`,
    ].join('\n'),
  )
}

// 无论成功还是失败，最后都断开数据库连接；失败时用非 0 退出码让终端命令报错。
main()
  .catch(error => {
    console.error('种子执行失败：', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
