/**
 * @file apps/web/src/pages/LoginPage.tsx
 * @description 登录页：输入用户名 + 密码，调用 AuthContext.login()，成功后跳回原目标页。
 *
 * 交互细节：
 *   - 提交期间按钮禁用并显示“登录中…”，防止重复提交；
 *   - 接口报错（如“用户名或密码错误”）显示在表单上方红色提示区；
 *   - 已经登录的用户访问 /login 会自动跳回首页；
 *   - 登录成功后的跳转优先级：路由 state 里记住的页面 > URL 的 redirect 参数 > 首页。
 */
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // 表单字段与界面状态。
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 已登录用户手动打开 /login：直接回首页，避免登录页与主界面并存。
  if (user) return <Navigate to="/" replace />

  /**
   * 计算登录成功后要跳回的地址。
   * location.state.from 是 RequireAuth 记住的完整地址对象；
   * 其次读 URL 上的 ?redirect=/xxx（401 全局跳转时携带）。
   */
  const redirectTarget = (): string => {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
    if (from) return from
    const params = new URLSearchParams(location.search)
    return params.get('redirect') ?? '/'
  }

  /** 提交登录表单。 */
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault() // 阻止表单默认的整页刷新行为
    // 前端先做一层基础校验（后端 DTO 还会再校验一次，两层各管各的）。
    if (username.trim().length < 3) {
      setError('用户名至少 3 个字符')
      return
    }
    if (password.length < 6) {
      setError('密码至少 6 位')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await login(username.trim(), password)
      // replace: true 让浏览器后退键不会退回到登录页。
      navigate(redirectTarget(), { replace: true })
    } catch (err) {
      // api 层抛出的错误形如 "HTTP_401: 用户名或密码错误（requestId: xxx）"，
      // 这里去掉开头的错误码前缀（错误码可含数字，如 HTTP_401）和结尾的 requestId，
      // 只把用户看得懂的“用户名或密码错误”展示出来。
      const raw = err instanceof Error ? err.message : '登录失败'
      setError(raw.replace(/^[A-Z0-9_]+:\s*/, '').replace(/（requestId:[^）]*）/, ''))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <span className="brand-mark">M</span>
          <div>
            Mini RAG<small>LOCAL KNOWLEDGE STUDIO</small>
          </div>
        </div>
        <h1>登录</h1>
        <p className="login-subtitle">使用你的账号继续访问本地知识库工作台</p>

        {/* 错误提示区：只有 error 非空时才渲染 */}
        {error && <div className="login-error">{error}</div>}

        <label className="login-field">
          <span>用户名</span>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="请输入用户名"
            autoComplete="username"
            // 登录页打开时光标直接落在用户名输入框。
            autoFocus
          />
        </label>

        <label className="login-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="请输入密码"
            autoComplete="current-password"
          />
        </label>

        <button type="submit" disabled={submitting} className="login-button">
          {submitting ? '登录中…' : '登 录'}
        </button>

        <p className="login-hint">本地账号由管理员通过种子脚本创建，不开放自助注册。</p>
      </form>
    </div>
  )
}
