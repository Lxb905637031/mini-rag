import { useEffect, useState } from 'react'
import { api, type Chunk, type DocumentRecord, type KnowledgeBase } from '../services/api'

const statusText: Record<string, string> = {
  PENDING: '等待处理',
  PROCESSING: '正在索引',
  COMPLETED: '已就绪',
  ERROR: '处理失败',
}

export function KnowledgePage() {
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [baseId, setBaseId] = useState('')
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [chunks, setChunks] = useState<Chunk[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 文档列表是否正在加载（首次进入或手动刷新时为 true）：控制刷新图标旋转并防止重复点击
  const [refreshing, setRefreshing] = useState(false)
  const refreshBases = async () => {
    const items = await api.bases()
    setBases(items)
    setBaseId(current => current || items[0]?.id || '')
  }
  useEffect(() => {
    void refreshBases().catch(error => setError(error.message))
  }, [])
  // 拉取指定知识库的文档列表：文档表格只有这一个数据请求入口，初始化加载与手动刷新共用
  const loadDocuments = (id: string) => {
    setRefreshing(true) // 进入加载态：刷新按钮开始旋转并暂时禁用
    void api
      .documents(id)
      .then(setDocuments) // 请求成功后用服务端返回的最新列表覆盖页面状态
      .catch(error => setError(error.message))
      .finally(() => setRefreshing(false)) // 无论成功还是失败都解除加载态
  }
  useEffect(() => {
    if (!baseId) return
    // 切换知识库时只自动加载一次；不再定时轮询，之后的状态更新全部由用户手动点刷新触发，减轻服务端压力
    loadDocuments(baseId)
  }, [baseId])
  // 点击刷新图标时调用：未选中知识库或正在加载中则直接忽略，避免短时间内发出重复请求
  const refreshDocuments = () => {
    if (!baseId || refreshing) return
    loadDocuments(baseId)
  }
  const upload = async (files: FileList | null) => {
    if (!files || !baseId) return
    setBusy(true)
    setError('')
    try {
      for (const file of Array.from(files)) await api.upload(baseId, file)
      setDocuments(await api.documents(baseId))
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">YOUR KNOWLEDGE, CONNECTED</div>
          <h1>让文档成为答案</h1>
          <p>上传资料，建立可追溯的本地知识库。</p>
        </div>
        <span className="pill">知识库 / 管理</span>
      </header>
      {/*
       * 工具栏已移除：注册时后端会自动为每个用户创建“默认知识库”，
       * 页面加载后 refreshBases 自动选中第一个（也是唯一一个）知识库，
       * 上传区直接可用。原“选择知识库下拉 + 手动创建”属于多余交互。
       */}
      {error && <div className="alert">{error}</div>}
      <div className="stats-grid">
        <div className="stat">
          <span>文档总数</span>
          <strong>{documents.length}</strong>
        </div>
        <div className="stat">
          <span>已就绪</span>
          <strong>{documents.filter(item => item.status === 'COMPLETED').length}</strong>
        </div>
        <div className="stat">
          <span>知识切片</span>
          <strong>{documents.reduce((count, item) => count + item.chunkCount, 0)}</strong>
        </div>
      </div>
      <label className={`upload-zone ${!baseId || busy ? 'disabled' : ''}`}>
        <div className="upload-icon">↑</div>
        <h3>{busy ? '正在上传…' : '把知识放进来'}</h3>
        <p>点击选择文件，支持 PDF、Word（.doc/.docx）、TXT 和 Markdown</p>
        <span>每个文件最大 10 MB · 文本型 PDF</span>
        <input
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.txt,.md,.markdown"
          disabled={!baseId || busy}
          onChange={event => void upload(event.target.files)}
        />
      </label>
      <section className="panel">
        <div className="panel-heading">
          <h2>文档</h2>
          {/* 标题栏右侧：文件数量 + 手动刷新按钮 */}
          <div className="panel-actions">
            <span>{documents.length} 个文件</span>
            {/* 手动刷新按钮：替代原来的每 2.5 秒定时轮询，只有用户点击时才向服务端请求一次 */}
            <button
              type="button"
              className={`refresh-button${refreshing ? ' spinning' : ''}`}
              onClick={refreshDocuments}
              disabled={!baseId || refreshing}
              title="刷新文档列表"
              aria-label="刷新文档列表"
            >
              ↻
            </button>
          </div>
        </div>
        {documents.length === 0 ? (
          <div className="empty">先创建知识库，再上传第一份文档。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>文件名称</th>
                <th>状态</th>
                <th>切片</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(document => (
                <tr key={document.id}>
                  <td>
                    <div className="file-name">▤ {document.originalName}</div>
                    {document.errorMessage && (
                      <small className="error-text">{document.errorMessage}</small>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${document.status.toLowerCase()}`}>
                      {statusText[document.status]}
                    </span>
                  </td>
                  <td>{document.chunkCount}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() =>
                        void api
                          .chunks(baseId, document.id)
                          .then(setChunks)
                          .catch(error => setError(error.message))
                      }
                    >
                      切片
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() =>
                        void api
                          .deleteDocument(baseId, document.id)
                          .then(() => api.documents(baseId))
                          .then(setDocuments)
                          .catch(error => setError(error.message))
                      }
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {chunks && (
        <div className="modal-backdrop" onClick={() => setChunks(null)}>
          <section className="drawer" onClick={event => event.stopPropagation()}>
            <div className="panel-heading">
              <h2>文档切片</h2>
              <button className="text-button" onClick={() => setChunks(null)}>
                关闭
              </button>
            </div>
            {chunks.map(chunk => (
              <article className="source-card" key={chunk.id}>
                <strong>切片 {chunk.chunkIndex + 1}</strong>
                <p>{chunk.content}</p>
              </article>
            ))}
          </section>
        </div>
      )}
    </>
  )
}
