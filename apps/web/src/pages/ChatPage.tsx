import { useEffect, useState } from 'react'
import {
  api,
  streamChatQuery,
  type ChatResult,
  type KnowledgeBase,
  type SearchResult,
} from '../services/api'

export function ChatPage() {
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [baseId, setBaseId] = useState('')
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('hybrid')
  const [rerank, setRerank] = useState(false)
  const [result, setResult] = useState<ChatResult | null>(null)
  // 流式过程中的部分结果：trace 先到（渲染右侧来源），answer 随 delta 增长（打字机效果）。
  const [partial, setPartial] = useState<{
    answer: string
    trace: ChatResult['trace'] | null
  } | null>(null)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void api
      .bases()
      .then(items => {
        setBases(items)
        setBaseId(items[0]?.id ?? '')
      })
      .catch(error => setError(error.message))
  }, [])
  const ask = async () => {
    if (!query.trim() || !baseId) return
    setBusy(true)
    setError('')
    setQuestion(query)
    setResult(null)
    setPartial(null)
    try {
      const finalResult = await streamChatQuery(
        { knowledgeBaseId: baseId, query, mode, topK: 4, rerank },
        {
          // 检索完成：右侧“检索依据”面板立刻可用，答案稍后流式到达。
          onTrace: trace => setPartial({ answer: '', trace }),
          onDelta: (_delta, answerSoFar) =>
            setPartial(prev => ({ answer: answerSoFar, trace: prev?.trace ?? null })),
        },
      )
      setResult(finalResult)
      setPartial(null)
      setQuery('')
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // 展示中的答案：优先最终结果；流式期间用部分结果（answer 已有内容时渲染打字机）。
  const displayAnswer = result?.answer ?? (partial?.answer || '')
  const activeTrace = result?.trace ?? partial?.trace ?? null
  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">ASK WITH EVIDENCE</div>
          <h1>与知识对话</h1>
          <p>每个答案，都能回到原文。</p>
        </div>
        <span className="pill">Ollama 本地模型</span>
      </header>
      {/* <div className="toolbar">
        <select
          aria-label="选择知识库"
          value={baseId}
          onChange={event => setBaseId(event.target.value)}
        >
          {bases.length === 0 && <option value="">请先上传文档</option>}
          {bases.map(base => (
            <option key={base.id} value={base.id}>
              {base.name}
            </option>
          ))}
        </select>
        <div className="segmented">
          {[
            ['vector', '向量'],
            ['bm25', 'BM25'],
            ['hybrid', '混合 RRF'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={mode === value ? 'active' : ''}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rerank}
            onChange={event => setRerank(event.target.checked)}
          />{' '}
          词法重排实验
        </label>
      </div> */}
      {error && <div className="alert">{error}</div>}
      <div className="chat-grid">
        <section className="chat-panel">
          <div className="conversation">
            {!question && (
              <div className="chat-welcome">
                <div className="spark">✦</div>
                <h2>从一个问题开始</h2>
                <p>我会先检索知识库，再依据相关片段回答。</p>
                <div className="suggestions">
                  {['这份资料的核心观点是什么？', '什么是 RRF 融合？'].map(item => (
                    <button key={item} onClick={() => setQuery(item)}>
                      {item} ↗
                    </button>
                  ))}
                </div>
              </div>
            )}
            {question && <div className="message user-message">{question}</div>}
            {busy && !displayAnswer && (
              <div className="message assistant-message">
                <span className="status-dot" /> 正在检索与生成…
              </div>
            )}
            {displayAnswer && (
              <div className="message assistant-message">
                <div className="answer-label">✦ MINI RAG</div>
                <p>
                  {displayAnswer}
                  {busy && <span className="status-dot" aria-label="生成中" />}
                </p>
                {activeTrace && (
                  <small>
                    {busy
                      ? `生成中 · 检索 ${activeTrace.durationMs} ms · ${activeTrace.reranked.length} 个来源`
                      : `检索 ${activeTrace.durationMs} ms · ${activeTrace.reranked.length} 个来源`}
                  </small>
                )}
              </div>
            )}
          </div>
          <form
            className="composer"
            onSubmit={event => {
              event.preventDefault()
              void ask()
            }}
          >
            <textarea
              aria-label="问题"
              placeholder="输入问题，探索你的知识库…"
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void ask()
                }
              }}
            />
            <button disabled={busy || !baseId || !query.trim()}>
              {busy ? '处理中' : '发送 ↑'}
            </button>
          </form>
          <div className="composer-note">答案由本地模型生成，请结合引用原文核实。</div>
        </section>
        <aside className="sources-panel">
          <div className="panel-heading">
            <h2>检索依据</h2>
            <span>{activeTrace?.reranked.length ?? 0} 个片段</span>
          </div>
          {activeTrace ? (
            activeTrace.reranked.map((item, index) => (
              <Source key={item.id} item={item} index={index} />
            ))
          ) : (
            <div className="empty">提问后在这里查看来源与排序。</div>
          )}
          {activeTrace && (
            <details className="trace">
              <summary>查看检索过程</summary>
              {(['vector', 'bm25', 'fused'] as const).map(type => (
                <div key={type}>
                  <strong>{type === 'fused' ? 'RRF 融合' : type}</strong>
                  {activeTrace[type].map((item, index) => (
                    <small key={item.id}>
                      #{index + 1} {String(item.metadata.fileName)} · {item.score.toFixed(4)}
                    </small>
                  ))}
                </div>
              ))}
            </details>
          )}
        </aside>
      </div>
    </>
  )
}

function Source({ item, index }: { item: SearchResult; index: number }) {
  return (
    <article className="source-card">
      <div className="source-title">
        <span>S{index + 1}</span>
        <strong>{String(item.metadata.fileName ?? '文档')}</strong>
      </div>
      <p>{item.pageContent}</p>
      <small>排序分数 {item.score.toFixed(4)}</small>
    </article>
  )
}
