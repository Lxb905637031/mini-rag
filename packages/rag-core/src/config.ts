/**
 * @file packages/rag-core/src/config.ts
 * @description RAG 核心库的“统一配置中心”。
 *
 * 小白导读：
 * - 程序运行时经常需要一些“可调整的参数”，比如 Ollama 在哪个端口、每次检索取几个片段。
 *   这些参数不写死在代码里，而是放在环境变量（.env 文件或系统环境变量）中，需要改时不用动代码。
 * - 本文件就负责：读取环境变量 → 检查值是否合法 → 组装成一个类型安全的 RagConfig 对象，
 *   供 embedding、向量库、检索、生成等所有模块统一使用。
 * - 这里用 Node.js 自带的 process.loadEnvFile() 读取 .env 文件，无需第三方 dotenv 依赖；
 *   老版本 Node 没有这个方法时则静默跳过（显式设置的环境变量依然有效）。
 */
import type { RagConfig } from './types.js'

/**
 * 在模块加载时尝试读取项目根目录的 .env 文件。
 *
 * 为什么写成立即执行：以前这里是 `import 'dotenv/config'`，靠“导入副作用”在程序启动瞬间
 * 把 .env 的键值灌入 process.env；现在用 Node 原生能力实现同样效果。
 */
const loadEnv = () => {
  // process.loadEnvFile 是 Node 20.12+ 才有的 API；用类型断言安全地探测它是否存在，
  // 避免在低版本 Node 上直接调用导致 “is not a function” 报错。
  const loader = (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }).loadEnvFile
  if (loader) {
    try {
      // 不传路径时，Node 会从当前工作目录向上查找 .env 文件。
      loader()
    } catch {
      // 没有 .env 文件时忽略：例如单元测试或 CI 中直接注入环境变量，不依赖文件。
    }
  }
}

// 模块加载即执行一次，保证后续读取 process.env 时能拿到 .env 中的值。
loadEnv()

/**
 * 读取一个“正整数”环境变量，并做合法性校验。
 *
 * @param name 环境变量名（仅用于报错提示，让人知道是哪个配置写错了）
 * @param value 从环境变量表拿到的原始字符串；未设置时为 undefined
 * @param fallback 缺省值：环境变量未设置时使用
 * @returns 解析后的正整数
 * @throws {Error} 当值不是整数、是 NaN 或小于等于 0 时抛出，阻止程序带着错误配置启动
 *                 （“快速失败”：启动阶段报错比运行到一半出错更容易定位问题）
 */
const positiveInt = (name: string, value: string | undefined, fallback: number) => {
  // 未配置就用默认值；配置了就把字符串转成数字（Number('abc') 会得到 NaN）。
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${String(value)}`)
  }
  return parsed
}

/**
 * 组装整个核心库的配置对象。
 *
 * @param env 环境变量表，默认取 Node 的 process.env；允许传参是为了单元测试方便
 *            （测试里可以直接传一个普通对象，无需真的设置系统环境变量）
 * @returns 符合 RagConfig 类型约束的配置对象
 * @throws {Error} 数值参数非法、或 chunkOverlap >= chunkSize 时抛出
 */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): RagConfig => {
  // 每个文本块的目标字符数，环境变量 RAG_CHUNK_SIZE，默认 300。
  // mxbai-embed-large 等模型大约接受 512 个 token；300 个字符能让中文及中英混合内容
  // 安全地留在模型输入上限内。调大：单块信息更完整，但切块变少、检索定位变粗；
  // 调小：定位更精准，但块内上下文可能不完整。
  const chunkSize = positiveInt('RAG_CHUNK_SIZE', env.RAG_CHUNK_SIZE, 300)

  // 相邻两个块之间重叠的字符数，环境变量 RAG_CHUNK_OVERLAP，默认 40。
  // 调大：跨块的句子更不容易被切断，但重复内容变多、存储与 token 浪费；
  // 调小甚至为 0：省空间，但块边界处的上下文容易断裂。
  const chunkOverlap = positiveInt('RAG_CHUNK_OVERLAP', env.RAG_CHUNK_OVERLAP, 40)

  // 重叠必须小于块本身，否则切块逻辑会退化甚至死循环，提前拦截非法组合。
  if (chunkOverlap >= chunkSize) {
    throw new Error('RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE')
  }

  return {
    // Ollama 本地服务地址。默认本机 11434 端口（Ollama 安装后的默认端口），本地开发无需修改。
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    // 负责“生成回答”的对话模型名称（必须是本机 Ollama 已 pull 的模型）。
    chatModel: env.OLLAMA_CHAT_MODEL ?? 'llama3.2:3b',
    // 负责“文本转向量”的嵌入模型名称。
    // 注意：入库与提问必须使用同一个嵌入模型，否则向量不在同一空间、检索结果会错乱；
    // 更换模型后需要重建向量库（重新摄入文档）。
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL ?? 'mxbai-embed-large',
    // Chroma 向量数据库服务地址，默认 8000 端口（Chroma 官方服务的默认端口）。
    chromaUrl: env.CHROMA_URL ?? 'http://127.0.0.1:8000',
    // 在 Chroma 中使用的集合（collection，类似关系库中的“表”）名称。
    chromaCollection: env.CHROMA_COLLECTION ?? 'mini_rag_documents',
    // 每次问答最终取用多少个检索块，环境变量 RAG_TOP_K，默认 4。
    // 调大：给大模型的参考资料更多、覆盖更全，但无关块增多且 prompt 变长、延迟上升；
    // 调小：回答更快更省，但可能因漏召回而“找不到依据”。
    topK: positiveInt('RAG_TOP_K', env.RAG_TOP_K, 4),
    chunkSize,
    chunkOverlap,
  }
}
