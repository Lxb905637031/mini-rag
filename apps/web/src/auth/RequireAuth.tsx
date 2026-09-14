/**
 * @file apps/web/src/auth/RequireAuth.tsx
 * @description 路由守卫组件：把需要登录才能访问的页面包起来。
 *
 * 行为：
 *   - 应用启动正在校验令牌时：显示“正在恢复登录状态…”，避免未验证完就闪一下登录页；
 *   - 未登录访问受保护页面：重定向到 /login，并记住用户原本想去的地址，
 *     登录成功后直接跳回那里（体验更好）；
 *   - 已登录：正常渲染被包裹的页面。
 */
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, bootstrapping } = useAuth()
  const location = useLocation()

  // 令牌校验中：先给一个简单的全屏加载提示。
  if (bootstrapping) {
    return <div className="auth-loading">正在恢复登录状态…</div>
  }

  // 没有用户信息 = 未登录。state.from 记录当前地址，登录页据此跳回。
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
