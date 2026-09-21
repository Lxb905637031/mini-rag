/**
 * @file apps/web/src/App.tsx
 * @description 应用根组件：组装登录状态提供者与全部路由。
 *
 * 路由结构：
 *   /login                登录页（公开；登录/注册 Tab 二合一，已登录访问会自动跳回首页）
 *   /register             重定向到 /login?tab=register（注册已合并进登录页的 Tab）
 *   /  /chat  /lab        受保护页面，统一套 AppLayout（侧边栏 + 内容区），
 *                         未登录时由 RequireAuth 重定向到 /login。
 *
 * 小白导读：
 * - AuthProvider 必须包住路由：这样路由守卫和各页面才能共享登录状态。
 * - 嵌套路由中没有 path 的父级路由用于“布局复用”：AppLayout 里的 <Outlet/>
 *   会渲染当前匹配到的子页面。
 */
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { KnowledgePage } from './pages/KnowledgePage'
import { ChatPage } from './pages/ChatPage'
import { LabPage } from './pages/LabPage'
import { LoginPage } from './pages/LoginPage'

/**
 * 登录后的整体布局：左侧固定侧边栏，右侧渲染子页面。
 * 侧边栏底部显示当前登录用户与“退出登录”按钮。
 */
function AppLayout() {
  const { user, logout } = useAuth()
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">M</span>
          <span>
            Mini RAG<small>LOCAL KNOWLEDGE STUDIO</small>
          </span>
        </a>
        <nav>
          <NavLink to="/">◈ 知识库</NavLink>
          <NavLink to="/chat">◇ 对话问答</NavLink>
          <NavLink to="/lab">⊞ 检索实验室</NavLink>
        </nav>
        <div className="sidebar-bottom">
          {/* 当前登录用户：优先显示昵称，没有则显示用户名 */}
          <div className="sidebar-user">
            <span className="user-avatar">
              {(user?.displayName ?? user?.username ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <div className="user-meta">
              <span className="user-name">{user?.displayName ?? user?.username}</span>
              <small>@{user?.username}</small>
            </div>
          </div>
          {/* 退出登录：AuthContext.logout 会拉黑令牌并跳转登录页 */}
          <button type="button" className="logout-button" onClick={() => void logout()}>
            退出登录
          </button>
          <div className="sidebar-status">
            <span className="status-dot" /> 本地优先<small>Ollama · Chroma · Redis</small>
          </div>
        </div>
      </aside>
      <main className="main">
        {/* 子路由（知识库/对话/实验室）在这里渲染 */}
        <Outlet />
      </main>
    </div>
  )
}

/** 路由表本身；AuthProvider 在更外层提供登录状态。 */
export function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* 公开路由：登录页（登录/注册 Tab 二合一） */}
        <Route path="/login" element={<LoginPage />} />
        {/* 旧注册页地址重定向到登录页的注册 Tab，收藏过 /register 的链接不失效 */}
        <Route path="/register" element={<Navigate to="/login?tab=register" replace />} />

        {/* 受保护路由：整组套登录守卫与统一布局 */}
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<KnowledgePage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/lab" element={<LabPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
