/**
 * @file apps/api/src/common/authenticated-request.ts
 * @description “已登录请求”的统一类型定义（全项目唯一来源 Single Source of Truth）。
 *
 * 小白导读：
 * - 浏览器每次请求都会带上 JWT 令牌；JwtAuthGuard 校验通过后，会把当前登录用户的信息
 *   挂到 Express 请求对象的 req.user 上。
 * - Express 原生的 Request 类型里没有 user 字段，所以这里扩展一个 AuthenticatedRequest，
 *   所有需要拿“当前用户”的控制器都从本文件导入，避免各处自己声明导致字段不一致。
 */
import type { Request } from 'express'

/**
 * 登录用户的最小信息（JWT 守卫解析令牌后写入 req.user 的内容）。
 * 注意：这里刻意不含密码哈希等敏感字段。
 */
export interface AuthUser {
  // 用户 id（对应数据库 User.id，也是 JWT payload 里的 sub）。
  id: string
  // 登录用户名。
  username: string
}

/**
 * 带登录用户信息的请求对象类型。
 * user 设为可选（user?）：因为在守卫执行之前的类型层面它还不存在；
 * 受保护的接口里守卫一定先执行，所以控制器中可以直接当它有值来用。
 */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser
}
