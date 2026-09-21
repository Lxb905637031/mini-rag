/**
 * @file apps/web/src/services/api.ts
 * @description 前端唯一的 HTTP 请求层：统一拼接地址、携带登录令牌、解析统一响应结构、
 *              处理登录失效（401）。页面组件只调用这里导出的 api 对象，不直接写 fetch。
 *
 * 小白导读：
 * - 登录成功后后端返回一个 JWT 令牌（accessToken），我们把它存在浏览器 localStorage，
 *   之后每个请求都通过 Authorization 请求头带上它，后端据此识别“你是谁”。
 * - localStorage 的特点：关掉页面再打开仍然在；同源页面共享；只能存字符串。
 * - 任何接口返回 401（未登录/令牌失效/已退出），统一清除登录态并跳回登录页，
 *   不需要每个页面自己处理。
 */

// 后端基础地址：Vite 读取 .env 里的 VITE_API_URL，缺省指向本地 3001 端口。
const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

// localStorage 中保存令牌的键名，抽成常量避免拼写不一致。
const TOKEN_STORAGE_KEY = 'mini-rag_token'

/** 登录用户资料（与后端 SafeUser 形状保持一致；不含密码哈希等敏感信息）。 */
export interface AuthUser {
  id: string
  username: string
  displayName: string | null
  createdAt: string
}

/** 登录接口返回的数据：令牌 + 用户资料。 */
export interface LoginResponse {
  accessToken: string
  user: AuthUser
}

export interface KnowledgeBase {
  id: string
  name: string
  ownerId?: string | null
  _count?: { documents: number }
}
export interface DocumentRecord {
  id: string
  originalName: string
  status: string
  chunkCount: number
  errorMessage?: string
  createdAt: string
}
export interface Chunk {
  id: string
  content: string
  chunkIndex: number
  metadata?: Record<string, unknown>
}
export interface SearchResult {
  id: string
  pageContent: string
  score: number
  metadata: Record<string, unknown>
}
export interface ChatResult {
  answer: string
  trace: {
    mode: string
    vector: SearchResult[]
    bm25: SearchResult[]
    fused: SearchResult[]
    reranked: SearchResult[]
    durationMs: number
  }
}

/** 后端统一响应信封结构（成功/失败都长这样）。 */
interface ApiEnvelope<T> {
  success: boolean
  code: string
  message: string
  data: T
  meta?: { requestId?: string; timestamp?: string; path?: string; durationMs?: number }
  error?: { type?: string; details?: string }
}

/**
 * 令牌的内存缓存 + localStorage 持久化封装。
 * 用函数闭包包住变量，外部只能通过 tokenStore 读写，便于统一管理持久化时机。
 */
export const tokenStore = {
  // 页面刚加载时从 localStorage 恢复令牌（刷新页面不掉登录态）。
  token: localStorage.getItem(TOKEN_STORAGE_KEY) as string | null,
  /** 保存令牌（登录成功）：同时写内存和 localStorage。 */
  set(token: string) {
    this.token = token
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
  },
  /** 清除令牌（退出登录/401 失效）：内存与 localStorage 一起删。 */
  clear() {
    this.token = null
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  },
}

/**
 * “登录失效”回调：由 AuthContext 注册。
 * 401 时调用它去清空用户状态并跳转登录页；api 层本身不依赖 React 路由。
 */
let unauthorizedHandler: (() => void) | null = null

/** 注册 401 全局处理函数（应用启动时由 AuthContext 调用一次）。 */
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler
}

/** request 的扩展选项：比原生 RequestInit 多一个鉴权相关开关。 */
interface RequestOptions extends RequestInit {
  // true 表示即使返回 401 也不要触发“全局跳转登录页”。
  // 登录接口本身要用：密码错误返回 401 只是普通的“账号或密码错误”提示。
  skipUnauthorizedHandler?: boolean
}

/**
 * 统一请求函数：所有 api 方法都经它发出。
 * @param path 以 / 开头的接口路径（如 /auth/login）
 * @param options 原生 fetch 配置 + skipUnauthorizedHandler 开关
 * @returns 解析后的业务数据（已从统一信封中取出 data 字段）
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // 取出自定义开关，其余配置原样透传给 fetch。
  const { skipUnauthorizedHandler, ...fetchOptions } = options
  // 组装请求头：调用方传入的 headers 优先；有令牌时自动带上 Authorization。
  const headers = new Headers(fetchOptions.headers)
  if (tokenStore.token) headers.set('Authorization', `Bearer ${tokenStore.token}`)

  const response = await fetch(`${baseUrl}${path}`, { ...fetchOptions, headers })
  const body = (await response.json()) as ApiEnvelope<T>

  // HTTP 非 2xx 或信封里 success=false 都视为失败，抛出带中文信息的 Error 供页面 catch。
  if (!response.ok || body.success === false) {
    // 401 且不是登录接口：令牌失效/已退出，通知全局处理（清登录态 + 跳登录页）。
    if (response.status === 401 && !skipUnauthorizedHandler && unauthorizedHandler) {
      unauthorizedHandler()
    }
    const requestId = body.meta?.requestId ? `（requestId: ${body.meta.requestId}）` : ''
    throw new Error(
      `${body.code ?? 'REQUEST_FAILED'}: ${body.error?.details ?? body.message ?? '请求失败'}${requestId}`,
    )
  }
  return body.data
}

/** 页面调用的全部接口集合（按业务分组）。 */
export const api = {
  // —— 认证相关 ——
  /** 注册：创建新账号，后端直接返回令牌（注册即登录）。返回结构与 login 完全一致。 */
  register: (username: string, password: string, displayName?: string) =>
    request<LoginResponse>('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // displayName 为 undefined 时 JSON.stringify 会自动丢掉这个键（后端视为未填）。
      body: JSON.stringify({ username, password, displayName }),
      // 注册接口本身是公开的，401（理论上不会出现）也不应触发全局跳转。
      skipUnauthorizedHandler: true,
    }),
  /** 登录：用户名密码换令牌。401 不触发全局跳转，只把“用户名或密码错误”抛给登录页。 */
  login: (username: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      skipUnauthorizedHandler: true,
    }),
  /** 查询当前登录用户资料（刷新页面时用它验证令牌是否仍有效）。 */
  profile: () => request<AuthUser>('/auth/profile'),
  /** 退出登录：后端把当前令牌加入 Redis 黑名单，前端随后清除本地令牌。 */
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),

  // —— 知识库 ——
  // 说明：创建知识库的 createBase 已删除——注册时后端自动为用户建“默认知识库”，
  // 前端不再需要手动创建入口；后端 POST /knowledge-bases 接口本身仍然保留。
  bases: () => request<KnowledgeBase[]>('/knowledge-bases'),
  documents: (id: string) => request<DocumentRecord[]>(`/knowledge-bases/${id}/documents`),
  upload: (id: string, file: File) => {
    const data = new FormData()
    data.append('file', file)
    // 上传文件时不要手动设置 Content-Type：浏览器要自动带上 multipart 边界标识。
    return request<DocumentRecord>(`/knowledge-bases/${id}/documents`, {
      method: 'POST',
      body: data,
    })
  },
  chunks: (baseId: string, documentId: string) =>
    request<Chunk[]>(`/knowledge-bases/${baseId}/documents/${documentId}/chunks`),
  deleteDocument: (baseId: string, documentId: string) =>
    request(`/knowledge-bases/${baseId}/documents/${documentId}`, { method: 'DELETE' }),
  query: (body: {
    knowledgeBaseId: string
    query: string
    mode: string
    topK: number
    rerank: boolean
  }) =>
    request<ChatResult>('/chat/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  preview: (text: string, strategy: string) =>
    request<{
      chunks: { pageContent: string; metadata: Record<string, unknown> }[]
      durationMs: number
    }>('/lab/chunks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, strategy }),
    }),
}
