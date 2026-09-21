/**
 * @file apps/web/src/pages/LoginPage.tsx
 * @description 登录/注册二合一页面：同一张卡片里用顶部 Tab 在“登录/注册”两种模式间切换。
 *
 * 交互细节：
 *   - Tab 切换不跳转页面，只切换表单字段与提交逻辑，切换时清空错误提示；
 *   - 支持 /login?tab=register 直接打开注册 Tab（旧链接 /register 会重定向到这里）；
 *   - 登录成功后跳回原目标页（路由 state 记住的页面 > redirect 参数 > 首页）；
 *   - 注册成功即登录并进入首页；
 *   - 提交期间按钮禁用并显示“登录中…/注册中…”，防止重复提交；
 *   - 已经登录的用户访问本页会自动跳回首页。
 */
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

/** 页面当前模式：login=登录表单，register=注册表单。 */
type Mode = 'login' | 'register'

export function LoginPage() {
  // 从 AuthContext 取登录、注册两个方法与当前用户状态。
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // 初始 Tab：URL 带 ?tab=register 时直接停在注册页签，否则默认登录。
  // useState 传初始化函数（惰性初始化）：只在组件首次渲染时读一次 URL。
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(location.search).get('tab') === 'register' ? 'register' : 'login',
  )

  // 表单字段与界面状态：注册模式比登录多“昵称/确认密码”两个输入。
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 密码明文开关：true 时输入框 type 变成 text，能直接看到所填内容。
  // “密码”与“确认密码”共用同一个开关——用户核对两次输入是否一致时，往往想同时看到两个框。
  const [showPassword, setShowPassword] = useState(false)

  // 已登录用户手动打开登录页：直接回首页，避免登录页与主界面并存。
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

  /** 切换 Tab：只清错误提示，已输入的用户名等字段保留，减少重复输入。 */
  const switchMode = (next: Mode) => {
    if (next === mode) return
    setMode(next)
    setError('')
  }

  /** 把接口错误清洗成用户看得懂的文案（去掉错误码前缀与 requestId 尾缀）。 */
  const readableError = (err: unknown, fallback: string): string => {
    const raw = err instanceof Error ? err.message : fallback
    return raw.replace(/^[A-Z0-9_]+:\s*/, '').replace(/（requestId:[^）]*）/, '')
  }

  /** 提交表单：根据当前 Tab 分派到登录或注册逻辑。 */
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault() // 阻止表单默认的整页刷新行为
    // —— 前端基础校验（后端 DTO 还会再校验一次，两层各管各的）——
    // 注册模式用完整正则校验用户名格式；登录模式只要非空到 3 字符即可（老账号规则可能更宽）。
    if (mode === 'register' && !/^[a-zA-Z0-9_]{3,32}$/.test(username.trim())) {
      setError('用户名只能包含 3~32 位字母、数字或下划线')
      return
    }
    if (mode === 'login' && username.trim().length < 3) {
      setError('用户名至少 3 个字符')
      return
    }
    if (password.length < 6) {
      setError('密码至少 6 位')
      return
    }
    // 确认密码只在注册模式存在，登录模式跳过该检查。
    if (mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      if (mode === 'login') {
        await login(username.trim(), password)
        // replace: true 让浏览器后退键不会退回到登录页。
        navigate(redirectTarget(), { replace: true })
      } else {
        // 昵称不填就传 undefined（JSON 序列化时自动丢掉该键，后端落库 null）。
        await register(username.trim(), password, displayName.trim() || undefined)
        // 注册即登录：本地令牌与用户状态已就绪，直接进入首页。
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError(readableError(err, mode === 'login' ? '登录失败' : '注册失败'))
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

        {/*
         * Tab 切换条：登录/注册共用同一张卡片。
         * type="button" 很关键——不写的话按钮默认 type="submit" 会触发表单提交。
         * role/aria-selected 是无障碍语义，读屏器可识别当前页签。
         */}
        <div className="login-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'login-tab active' : 'login-tab'}
            onClick={() => switchMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'login-tab active' : 'login-tab'}
            onClick={() => switchMode('register')}
          >
            注册
          </button>
        </div>

        {/* 标题与副标题随 Tab 联动变化。 */}
        <h1>{mode === 'login' ? '登录' : '注册'}</h1>
        <p className="login-subtitle">
          {mode === 'login'
            ? '使用你的账号继续访问本地知识库工作台'
            : '创建你的账号，拥有独立隔离的知识库空间'}
        </p>

        {/* 错误提示区：只有 error 非空时才渲染。 */}
        {error && <div className="login-error">{error}</div>}

        <label className="login-field">
          <span>用户名</span>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder={mode === 'login' ? '请输入用户名' : '3~32 位字母、数字或下划线'}
            autoComplete="username"
            // 页面打开时光标直接落在用户名输入框。
            autoFocus
          />
        </label>

        {/* 昵称只在注册 Tab 显示（条件渲染，登录模式不占空间）。 */}
        {mode === 'register' && (
          <label className="login-field">
            <span>昵称（可选）</span>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="界面里展示的名字，不填则用用户名"
              autoComplete="nickname"
            />
          </label>
        )}

        {/*
         * 密码框：type 在 password（密文圆点）与 text（明文）间切换。
         * 外面套一层 .input-wrap 做相对定位，眼睛按钮绝对定位在输入框右侧。
         */}
        <label className="login-field">
          <span>密码</span>
          <div className="input-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="至少 6 位"
              // 浏览器密码管理器依据该值区分“当前密码”与“新建密码”。
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            <button
              type="button"
              className="password-toggle"
              // 无障碍：读屏器朗读按钮用途（随状态切换文案）。
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              title={showPassword ? '隐藏密码' : '显示密码'}
              onClick={() => setShowPassword(v => !v)}
            >
              {/* 明文时显示“划线眼睛”（提示可关闭），密文时显示“眼睛”。 */}
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </label>

        {/* 确认密码只在注册 Tab 显示，与上面的密码框共用同一个明文开关。 */}
        {mode === 'register' && (
          <label className="login-field">
            <span>确认密码</span>
            <div className="input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="再输入一次相同的密码"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                title={showPassword ? '隐藏密码' : '显示密码'}
                onClick={() => setShowPassword(v => !v)}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>
        )}

        <button type="submit" disabled={submitting} className="login-button">
          {submitting
            ? mode === 'login'
              ? '登录中…'
              : '注册中…'
            : mode === 'login'
              ? '登 录'
              : '注 册'}
        </button>

        {/* 底部引导文案：与顶部的 Tab 呼应（不再需要跳转链接）。 */}
        <p className="login-hint">
          {mode === 'login'
            ? '没有账号？点击上方“注册”创建一个'
            : '已有账号？点击上方“登录”直接进入'}
        </p>
      </form>
    </div>
  )
}

/**
 * 睁眼图标（lucide eye 的经典造型）：出现在密码为密文状态时，
 * 点击后切换为明文。SVG 参数说明：
 *   - stroke 只描线不填充，线条宽 2，端点/拐角圆滑，视觉上更轻盈；
 *   - aria-hidden：纯装饰图示，读屏器靠按钮的 aria-label 朗读，图标本身不朗读。
 */
function EyeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 眼眶轮廓：两段弧线拼成的杏仁形。 */}
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      {/* 瞳孔。 */}
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/**
 * 闭眼/划线眼图标（lucide eye-off 造型）：出现在密码为明文状态时，
 * 点击后切回密文。多了一条对角斜线，直观表达“关闭可见”。
 */
function EyeOffIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 被遮挡感的眼眶：用带折断的弧线示意。 */}
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      {/* 对角斜线：贯穿整图表示“禁止显示”。 */}
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}
