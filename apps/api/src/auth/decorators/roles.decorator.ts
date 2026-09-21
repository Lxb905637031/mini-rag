/**
 * @file apps/api/src/auth/decorators/roles.decorator.ts
 * @description @Roles() 装饰器：把某个接口标记为「仅限指定角色访问」（RBAC 的标记要素）。
 *
 * 小白导读：
 * - RBAC（基于角色的访问控制）三要素：标记（本文件）、来源（JWT 里的 role 字段）、
 *   执行（roles.guard.ts）。本文件只负责「写元数据」，不做任何判断。
 * - 实现与 @Public() 完全同款：SetMetadata 把 { [ROLES_KEY]: ['admin', ...] }
 *   写进路由元数据，RolesGuard 用 Reflector 读出来对照。
 * - 为什么不直接在 Guard 里写死角色：声明式标记让权限规则贴在接口旁边，
 *   打开控制器一眼看清每个接口的访问要求，而不是藏在守卫的实现细节里。
 */
import { SetMetadata } from '@nestjs/common'

// 元数据键名常量：装饰器与守卫共用同一个字符串，避免拼写不一致。
export const ROLES_KEY = 'roles'

/** 系统支持的角色（阶段 2 给 User 表加 role 字段后，以数据库为准）。 */
export type UserRole = 'admin' | 'user'

/**
 * 角色装饰器工厂：用法 @Roles('admin') 或 @Roles('admin', 'user')。
 * @param roles 允许访问本接口的角色列表（命中任意一个即放行）
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles)
