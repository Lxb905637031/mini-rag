import { NavLink, Route, Routes } from 'react-router-dom'
import { KnowledgePage } from './pages/KnowledgePage'
import { ChatPage } from './pages/ChatPage'
import { LabPage } from './pages/LabPage'

export function App() {
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
          <span className="status-dot" /> 本地优先<small>Ollama · Chroma · LangChain.js</small>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<KnowledgePage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/lab" element={<LabPage />} />
        </Routes>
      </main>
    </div>
  )
}
