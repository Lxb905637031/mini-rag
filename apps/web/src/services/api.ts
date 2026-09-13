const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export interface KnowledgeBase {
  id: string
  name: string
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, options)
  const body = await response.json()
  if (!response.ok)
    throw new Error(
      Array.isArray(body.message) ? body.message.join('；') : (body.message ?? '请求失败'),
    )
  return body
}

export const api = {
  bases: () => request<KnowledgeBase[]>('/knowledge-bases'),
  createBase: (name: string) =>
    request<KnowledgeBase>('/knowledge-bases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  documents: (id: string) => request<DocumentRecord[]>(`/knowledge-bases/${id}/documents`),
  upload: (id: string, file: File) => {
    const data = new FormData()
    data.append('file', file)
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
