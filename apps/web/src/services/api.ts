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

// 后端基础地址：默认走相对路径 /api，由 Vite 开发服务器代理转发到本机 3001 端口
// （代理规则见 apps/web/vite.config.ts）。用相对路径而不是写死 http://localhost:3001，
// 是为了让手机等局域网设备访问时也能正确指向电脑：写死 localhost 的话，手机上的
// localhost 指的是手机自己，请求必然失败。生产环境如需指向独立域名，
// 可通过设置 VITE_API_URL 环境变量覆盖。
const baseUrl = import.meta.env.VITE_API_URL ?? '/api'

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
 * 流式问答的回调集合：检索完成 / 答案增量各回调一次。
 * streamChatQuery 内部维护完整答案，onDelta 第二个参数直接给出“到目前为止的完整文本”。
 */
interface StreamHandlers {
  onTrace?: (trace: ChatResult['trace']) => void
  onDelta?: (delta: string, answerSoFar: string) => void
}

/**
 * 流式问答（SSE）：POST /chat/query/stream。
 *
 * 为什么不用 EventSource：它只支持 GET 且无法携带 Authorization 头，
 * 所以这里用 fetch + ReadableStream 手动解析 `data: {...}\n\n` 帧。
 *
 * 错误处理与 request() 保持一致：HTTP 非 2xx 先解析统一信封再抛错；
 * 401 触发全局跳转。生成中途的失败以 {"type":"error"} 事件下发，同样抛 Error。
 */
export async function streamChatQuery(
  body: {
    knowledgeBaseId: string
    query: string
    mode: string
    topK: number
    rerank: boolean
  },
  handlers: StreamHandlers = {},
): Promise<ChatResult> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (tokenStore.token) headers.set('Authorization', `Bearer ${tokenStore.token}`)

  const response = await fetch(`${baseUrl}/chat/query/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  // 流还没开始：非 2xx 走统一信封错误（鉴权/参数/知识库归属等问题都在这里拦截）。
  if (!response.ok || !response.body) {
    let envelope: ApiEnvelope<unknown> | null = null
    try {
      envelope = (await response.json()) as ApiEnvelope<unknown>
    } catch {
      envelope = null
    }
    if (response.status === 401 && unauthorizedHandler) unauthorizedHandler()
    throw new Error(
      `${envelope?.code ?? 'REQUEST_FAILED'}: ${envelope?.error?.details ?? envelope?.message ?? '请求失败'}`,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // 用对象包装：闭包内赋值不会触发 TS 的控制流窄化，返回时不需要类型断言。
  const state: { answer: string; trace: ChatResult['trace'] | null } = {
    answer: '',
    trace: null,
  }

  // 逐帧解析：一条 SSE 消息以空行（\n\n）结束；我们只关心 data: 行。
  const consume = (frame: string) => {
    const dataLine = frame.split('\n').find(line => line.startsWith('data:'))
    if (!dataLine) return
    const payload = JSON.parse(dataLine.slice(5)) as {
      type: 'trace' | 'delta' | 'done' | 'error'
      content?: string
      answer?: string
      message?: string
      trace?: ChatResult['trace']
    }
    if (payload.type === 'trace' && payload.trace) {
      state.trace = payload.trace
      handlers.onTrace?.(payload.trace)
    } else if (payload.type === 'delta' && payload.content) {
      state.answer += payload.content
      handlers.onDelta?.(payload.content, state.answer)
    } else if (payload.type === 'done') {
      if (payload.answer) state.answer = payload.answer
      if (payload.trace) state.trace = payload.trace
    } else if (payload.type === 'error') {
      throw new Error(payload.message ?? '答案生成失败，请稍后重试')
    }
  }

  // 读取直到后端关闭流；按空行切帧，半截帧留在 buffer 里等下一批字节。
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) consume(frame)
  }
  if (buffer.trim()) consume(buffer)

  return { answer: state.answer, trace: state.trace as ChatResult['trace'] }
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
