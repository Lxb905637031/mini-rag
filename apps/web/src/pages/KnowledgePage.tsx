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
  const [name, setName] = useState('')
  const refreshBases = async () => {
    const items = await api.bases()
    setBases(items)
    setBaseId(current => current || items[0]?.id || '')
  }
  useEffect(() => {
    void refreshBases().catch(error => setError(error.message))
  }, [])
  useEffect(() => {
    if (!baseId) return
    const refresh = () =>
      void api
        .documents(baseId)
        .then(setDocuments)
        .catch(error => setError(error.message))
    refresh()
    const timer = setInterval(refresh, 2500)
    return () => clearInterval(timer)
  }, [baseId])
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
  const create = async () => {
    if (!name.trim()) return
    try {
      const base = await api.createBase(name.trim())
      setBases([...bases, base])
      setBaseId(base.id)
      setName('')
    } catch (error) {
      setError((error as Error).message)
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
      {/* <div className="toolbar">
        <select
          aria-label="选择知识库"
          value={baseId}
          onChange={event => setBaseId(event.target.value)}
        >
          <option value="">请选择知识库</option>
          {bases.map(base => (
            <option key={base.id} value={base.id}>
              {base.name}
            </option>
          ))}
        </select>
        <div className="inline">
          <input
            aria-label="新知识库名称"
            placeholder="新知识库名称"
            value={name}
            onChange={event => setName(event.target.value)}
          />
          <button onClick={() => void create()}>创建知识库</button>
        </div>
      </div> */}
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
          <span>{documents.length} 个文件</span>
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
