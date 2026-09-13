/**
 * @file packages/rag-core/src/types.ts
 * @description 整个 RAG 核心库共用的“类型字典”。这里只声明 TypeScript 类型
 *              （interface/type），不含任何运行时逻辑，编译后基本不产生可执行代码。
 *
 * 在 RAG 流水线中的位置：
 * - 数据入库：文档（loaders 加载）→ 切块（chunking）→ embedding 向量化 → 存入 Chroma
 * - 提问问答：问题向量化 → 检索（向量 / BM25 / 混合）→ 可选重排（rerank）→ 大模型生成答案
 * 本文件定义的类型贯穿上述所有环节，是各模块之间传递数据的“共同语言”：一个模块产出的对象
 * 必须满足某个 interface，另一个模块按同一个 interface 消费，出错在编译期就能被发现。
 *
 * 小白概念速查：
 * - chunk（文本块）：长文档被切成的小段文字。块太大容易混入无关内容（噪声），
 *   块太小又可能丢失上下文；chunkSize / chunkOverlap 就是用来调这个平衡。
 * - token：模型眼中的最小文字单位（中文常接近一个字，英文常是词的片段）。
 *   模型每次能处理的 token 数有上限，所以长文档必须先切块。
 * - embedding（向量嵌入）：把一段文字转换成一串数字（向量），语义越相近的文字，
 *   向量在数学空间里的距离也越近。
 * - 向量检索：把用户问题也转成向量，按向量距离找出语义最相似的文本块。
 * - BM25 检索：经典关键词匹配算法，按词频和稀有度打分，擅长精确命中专有名词、编号。
 * - hybrid（混合检索）：向量检索与 BM25 同时跑，再用 RRF 算法融合两路排名，兼顾语义和关键词。
 * - overlap（重叠）：相邻两个块重复保留一小段文字，避免一句话恰好被从中间切断。
 * - trace（检索轨迹）：把一次检索每一步的中间结果都记录下来，便于前端展示和排查问题。
 *
 * 小知识：本项目使用 ESM 模块规范，TypeScript 相对导入必须写上 .js 后缀
 * （例如写 './types.js'，虽然源文件其实是 types.ts），这是 ESM 模式的硬性要求。
 */

// 从 LangChain 引入 Document 类型（仅类型导入，编译后这行不会出现在 JS 中）。
// LangChain 的 Document 是文档处理的标准结构，形状为：
// { pageContent: string（文本正文）, metadata: Record<string, unknown>（元数据键值对） }
// 本项目的“加载”和“切块”阶段都以它为基础数据结构。
import type { Document } from '@langchain/core/documents'

/**
 * 切块策略类型：决定 chunking 模块用哪种方式把长文档切成小块。
 * 由调用方（摄入接口）指定，chunkDocuments 函数据此走不同分支。
 */
export type ChunkStrategy =
  | 'fixed' // 固定长度切分：每 chunkSize 个字符切一刀，实现最简单、结果最可预测
  | 'recursive' // 递归切分（默认策略）：优先在段落、换行、句子等自然边界切，尽量不切断语义
  | 'semantic' // 语义切分：先按句子做 embedding，相邻句子语义足够相近才合并，最“懂内容”但最慢
  | 'structure' // 结构切分：先按 Markdown 标题（# 到 ######）分章节，再在章节内部定长切

/**
 * 检索模式类型：决定提问时用哪条路线查找相关文本块。
 * 由问答接口的入参指定，检索服务 RetrievalService 据此选择检索分支。
 */
export type RetrievalMode =
  | 'vector' // 纯向量检索：靠语义相似度，能匹配“意思相同但用词不同”的内容
  | 'bm25' // 纯 BM25 关键词检索：靠词面匹配，命中专有名词、错误码、编号时更准
  | 'hybrid' // 混合检索：向量与 BM25 两路并行后用 RRF 融合，实际效果通常最稳健

/**
 * RAG 核心库的统一配置形状。
 * 由 config.ts 的 loadConfig() 从环境变量读取并组装，然后注入 embedding、向量库、
 * 检索、生成等各个模块。所有字段都是必填项，保证各模块拿到的配置完整可用。
 */
export interface RagConfig {
  // Ollama 本地服务地址（形如 http://127.0.0.1:11434）。embedding 与对话模型都通过它调用。
  ollamaBaseUrl: string
  // 负责“生成回答”的对话模型名称，必须是本机 Ollama 已拉取的模型（如 llama3.2:3b）。
  chatModel: string
  // 负责“文本转向量”的嵌入模型名称（如 mxbai-embed-large）。
  // 注意：入库和提问必须使用同一个嵌入模型，否则向量不在同一空间，检索结果会错乱。
  embeddingModel: string
  // Chroma 向量数据库的服务地址（形如 http://127.0.0.1:8000）。
  chromaUrl: string
  // Chroma 中的集合名（collection，可粗略理解为关系库里的“表”），文档向量都存在这个集合里。
  chromaCollection: string
  // 每次检索最终取用多少个最相关文本块。值越大参考资料越全，但噪声变多、耗时和 token 成本上升。
  topK: number
  // 每个文本块的目标大小，单位是“字符数”（不是 token）。
  chunkSize: number
  // 相邻文本块之间重叠的字符数。必须小于 chunkSize，作用是防止块边界把句子/语义拦腰截断。
  chunkOverlap: number
}

/**
 * 单条检索结果：一个被命中的文本块及其相关性信息。
 * 产生方：向量库检索、BM25 检索、RRF 融合、重排器都会输出它；
 * 消费方：RetrievalTrace 收集每一步的结果，最终由答案生成器取出 pageContent 作为参考资料。
 */
export interface SearchResult {
  // 文本块的唯一标识，来自向量库（Chroma）；BM25 路也会带上对应 id 以便两路结果对齐融合。
  id: string
  // 文本块的正文内容，也就是最终会塞进大模型 prompt、作为“答题依据”的文字。
  pageContent: string
  // 相关性分数。注意口径不统一：向量路是相似度（越大越相关），BM25 是关键词打分，
  // RRF 融合后是融合分。因此分数一般只用于“同一路内部排序”，不要跨路直接比大小。
  score: number
  // 附加元数据键值对，常见字段有 source（文件路径）、fileName（文件名）、structure（章节标题）等。
  metadata: Record<string, unknown>
}

/**
 * 一次检索的完整“轨迹”（trace）：把检索流水线上每一环节的结果原样记录下来。
 * 产生方：RetrievalService.search()；消费方：问答接口把它和 answer 一起返回给前端，
 * 用户可以看到“向量路找到了什么、BM25 找到了什么、融合/重排后留下了什么”，便于调试与展示。
 */
export interface RetrievalTrace {
  // 本次检索实际使用的模式：vector / bm25 / hybrid。
  mode: RetrievalMode
  // 向量检索一路返回的候选块（纯 bm25 模式下为空数组）。
  vector: SearchResult[]
  // BM25 关键词检索一路返回的候选块（纯 vector 模式下为空数组）。
  bm25: SearchResult[]
  // 两路结果经 RRF 融合并按 topK 截断后的结果；单路模式下即该路的结果。
  fused: SearchResult[]
  // 经过重排器（reranker）精排后的最终结果；未开启重排时与 fused 相同。
  // 答案生成器实际使用的就是这一列表。
  reranked: SearchResult[]
  // 本次检索总耗时，单位毫秒，用于观察性能。
  durationMs: number
}

/**
 * 重排器接口（一种“能力约定”）。
 * 初筛（向量/BM25）为了速度往往比较粗糙；重排器拿到候选块后用更精细的方式重新打分排序，
 * 提升最终送给大模型的资料质量。任何类只要实现了下面签名的 rerank 方法，就可以当作重排器使用，
 * 方便以后替换不同的重排模型而不用改调用方代码。
 */
export interface Reranker {
  /**
   * 对候选检索结果重新打分排序。
   * @param query 用户的原始问题
   * @param candidates 初筛阶段（融合后）得到的候选块列表
   * @returns 重排后的结果列表（通常是同批元素、顺序被调整），通过 Promise 异步返回
   */
  rerank(query: string, candidates: SearchResult[]): Promise<SearchResult[]>
}

/**
 * 加载文档后得到的文本块类型。
 *
 * 它继承（extends）自 LangChain 的 Document 类型：因此天然拥有
 * pageContent（文本正文）和 metadata（元数据）两个字段；
 * 这里用交叉类型（&）把 metadata 收窄为“任意键值对 + 必有 source、fileName 两个字段”，
 * 即每个块都必须能追溯到它来自哪个文件。
 *
 * 数据流：document-loader 加载文件时产生它（附加 source/fileName）→
 * chunking 切块时复制并延续这些元数据 → 向量化后连同元数据一起写入 Chroma →
 * 检索命中时再随结果带出，最终可用于在回答中标注引用来源。
 */
export interface LoadedChunk extends Document {
  // 元数据：既允许任意额外键（交叉类型左侧的 Record<string, unknown>），
  // 又强制要求 source（文件完整路径）和 fileName（文件名）两个字符串字段。
  metadata: Record<string, unknown> & { source: string; fileName: string }
}
