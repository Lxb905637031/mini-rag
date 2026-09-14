/**
 * @file apps/api/src/auth/decorators/public.decorator.ts
 * @description @Public() 装饰器：把某个接口标记为“无需登录即可访问”。
 *
 * 小白导读：
 * - 我们会给整个应用挂一个“全局 JWT 守卫”，默认所有接口都必须带有效的登录令牌。
 * - 但登录接口本身、健康检查接口显然不能要求“先登录才能登录”，需要例外放行。
 * - 在控制器类或方法上加 @Public()，守卫读到这个标记就直接放行。
 *
 * 实现原理：SetMetadata 会把 { [IS_PUBLIC_KEY]: true } 写进该路由的元数据，
 * 守卫里用 Reflector 把它读出来判断。
 */
import { SetMetadata } from '@nestjs/common'

// 元数据键名常量：守卫和装饰器两边共用同一个字符串，避免拼写不一致。
export const IS_PUBLIC_KEY = 'isPublic'

// 自定义装饰器工厂：调用写法为 @Public()。
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
