import { useState } from 'react'
import { api } from '../services/api'

const strategies = [
  { id: 'fixed', name: '固定大小', description: '按字符数切分，长度稳定，但可能截断完整语义。' },
  { id: 'recursive', name: '递归字符', description: '优先保留段落和句子，再退化到更小的分隔符。' },
  {
    id: 'semantic',
    name: '语义分块',
    description: '比较句向量，在主题变化处断开；需要 Embedding。',
  },
  { id: 'structure', name: '结构感知', description: '利用标题、页面边界保留章节上下文。' },
]
const indexes = [
  {
    name: 'Flat',
    badge: '精确基准',
    text: '逐条比较全部向量。召回精确，查询成本随数据量线性增长。适合小数据和评测基线。',
  },
  {
    name: 'HNSW',
    badge: 'Chroma 实际使用',
    text: '分层近邻图。先在稀疏高层快速定位，再在低层细搜。以较高内存换取低延迟和高召回。',
  },
  {
    name: 'IVF',
    badge: '原理与选型',
    text: '先聚类分桶，查询只扫描邻近的部分桶。扫描桶越多，召回越高、延迟也越高。',
  },
  {
    name: 'IVF-PQ',
    badge: '原理与选型',
    text: '在分桶基础上用乘积量化压缩向量。节省内存，但压缩距离存在误差，通常需要精排补偿。',
  },
]

export function LabPage() {
  const [text, setText] = useState(
    '# RAG 基础\n\nRAG 先检索知识库，再让模型依据片段回答。它不需要重新训练模型。\n\n## 混合检索\n\nBM25 擅长关键词，向量检索擅长语义。RRF 根据排名融合两种结果。',
  )
  const [strategy, setStrategy] = useState('recursive')
  const [chunks, setChunks] = useState<{ pageContent: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preview = async () => {
    setBusy(true)
    setError('')
    try {
      setChunks((await api.preview(text, strategy)).chunks)
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
          <div className="eyebrow">LEARN BY OBSERVING</div>
          <h1>把 RAG 拆开看</h1>
          <p>观察分块与排序，理解每个选择背后的代价。</p>
        </div>
        <span className="pill">实践 · 复盘 · 面试</span>
      </header>
      <section className="panel lab-panel">
        <div className="panel-heading">
          <h2>01 / 分块实验</h2>
          <span>同一文本，不同边界</span>
        </div>
        <div className="strategy-grid">
          {strategies.map(item => (
            <button
              key={item.id}
              className={`strategy ${strategy === item.id ? 'selected' : ''}`}
              onClick={() => setStrategy(item.id)}
            >
              <strong>{item.name}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
        <textarea
          className="lab-input"
          aria-label="实验文本"
          value={text}
          onChange={event => setText(event.target.value)}
        />
        <button disabled={busy || !text.trim()} onClick={() => void preview()}>
          {busy ? '正在切分…' : '运行分块实验 →'}
        </button>
        {error && <div className="alert">{error}</div>}
        <div className="chunk-grid">
          {chunks.map((chunk, index) => (
            <article className="source-card" key={index}>
              <strong>
                Chunk {index + 1} <small>{chunk.pageContent.length} 字符</small>
              </strong>
              <p>{chunk.pageContent}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel lab-panel">
        <div className="panel-heading">
          <h2>02 / 向量索引</h2>
          <span>速度、内存、召回率的取舍</span>
        </div>
        <div className="index-grid">
          {indexes.map(item => (
            <article className="index-card" key={item.name}>
              <span className="eyebrow">{item.badge}</span>
              <h3>{item.name}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel lab-panel">
        <div className="panel-heading">
          <h2>03 / 从召回到答案</h2>
        </div>
        <div className="pipeline">
          <div>
            <strong>BM25 + 向量</strong>
            <p>关键词与语义互补，先扩大候选范围。</p>
          </div>
          <span>→</span>
          <div>
            <strong>RRF 融合</strong>
            <p>按排名累计分数，不直接混合不同量纲。</p>
            <code>Σ weight / (60 + rank)</code>
          </div>
          <span>→</span>
          <div>
            <strong>Rerank</strong>
            <p>对候选重新评分。词法实验可升级为 bge/Cohere 模型。</p>
          </div>
          <span>→</span>
          <div>
            <strong>有依据地回答</strong>
            <p>将片段和来源交给 Ollama，要求引用与拒答。</p>
          </div>
        </div>
      </section>
    </>
  )
}
