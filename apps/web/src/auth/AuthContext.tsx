/**
 * @file apps/web/src/auth/AuthContext.tsx
 * @description 登录状态的全局管理（React Context）。
 *
 * 负责三件事：
 *   1. 保存“当前登录用户”；应用启动时如果本地有令牌，就调 /auth/profile 恢复登录态。
 *   2. 提供 login() / logout() 两个动作，供登录页和侧边栏按钮调用。
 *   3. 注册 401 全局回调：任何接口发现令牌失效，自动清登录态并跳到登录页。
 *
 * 小白导读：
 * - Context 可以理解为“全家共享的抽屉”：Provider 里放的数据，任意层级的组件
 *   不用一层层传 props，用 useAuth() 就能拿到。
 * - 令牌（token）存在 localStorage（见 services/api.ts 的 tokenStore），
 *   这里的 user 状态只存在内存：刷新页面后靠 profile 接口重新换取。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, onUnauthorized, tokenStore, type AuthUser } from '../services/api'

/** 共享出去的登录状态形状。 */
interface AuthContextValue {
  // 当前用户：null 表示未登录。
  user: AuthUser | null
  // 是否正在“启动时校验令牌”：为 true 时路由守卫先显示加载提示，避免登录页闪烁。
  bootstrapping: boolean
  // 登录动作：成功后令牌已存好、user 已更新，页面再自行跳转。
  login: (username: string, password: string) => Promise<void>
  // 退出动作：通知后端拉黑令牌，再清空本地状态。
  logout: () => Promise<void>
}

// 创建 Context；初始值给 null，配合下面的 useAuth 做“必须在 Provider 内使用”的保护。
const AuthContext = createContext<AuthContextValue | null>(null)

/** 组件获取登录状态的唯一入口：const { user, logout } = useAuth() */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内部使用')
  return ctx
}

/** 登录状态提供者：在应用根部包裹一次（见 App.tsx）。 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  // 初始是否正在启动校验：本地有令牌时先显示 true，profile 请求结束再放开。
  const [bootstrapping, setBootstrapping] = useState<boolean>(() => Boolean(tokenStore.token))
  const navigate = useNavigate()

  // 注册“401 登录失效”全局回调（只注册一次）。
  useEffect(() => {
    onUnauthorized(() => {
      // 清掉本地令牌与用户状态，然后跳登录页，并带上当前路径供登录后跳回。
      tokenStore.clear()
      setUser(null)
      const redirect = encodeURIComponent(window.location.pathname + window.location.search)
      navigate(`/login?redirect=${redirect}`, { replace: true })
    })
  }, [navigate])

  // 启动恢复：本地有令牌时，用它请求 /auth/profile 验证是否仍有效。
  useEffect(() => {
    if (!tokenStore.token) {
      setBootstrapping(false)
      return
    }
    api
      .profile()
      .then(setUser) // 令牌有效：恢复用户信息
      .catch(() => tokenStore.clear()) // 令牌无效/过期：清掉它，让路由守卫导向登录页
      .finally(() => setBootstrapping(false))
  }, [])

  /** 登录：调接口拿令牌并持久化、更新用户状态。错误直接抛给登录页展示。 */
  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password)
    tokenStore.set(result.accessToken)
    setUser(result.user)
  }, [])

  /** 退出：即使后端调用失败（如网络问题）也要清掉本地登录态。 */
  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      tokenStore.clear()
      setUser(null)
      navigate('/login', { replace: true })
    }
  }, [navigate])

  // useMemo 避免每次渲染都生成新对象导致所有消费组件无谓刷新。
  const value = useMemo(
    () => ({ user, bootstrapping, login, logout }),
    [user, bootstrapping, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
