/**
 * @file packages/rag-core/src/chunking/chunking.ts
 * @description 文档切块（chunking）模块：把解析后的长文档切成适合向量化与检索的小片段。
 *
 * 小白导读——为什么必须切块：
 * - 嵌入模型一次能处理的文本长度有限（约几百 token），整本书/整篇文章无法直接向量化。
 * - 切成小块后：每块单独变成一个向量，提问时只取回最相关的几块，省成本、定位准。
 * - overlap（块间重叠）让被切到边界上的句子不至于上下文断裂。
 *
 * 提供四种策略（ChunkStrategy）：
 *   fixed     固定字符数硬切，最简单；
 *   recursive 默认策略，优先按段落→句子等边界递归切分，尽量不切断语义（LangChain 提供）；
 *   semantic  按相邻句子的向量相似度切分，语义“话题跳转”处断开（最慢，需要嵌入模型）；
 *   structure 按 Markdown 标题（# ~ ######）先分章节再切，块上记录所属标题。
 */
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import type { Embeddings } from '@langchain/core/embeddings'
import type { Document } from '@langchain/core/documents'
import type { ChunkStrategy, LoadedChunk } from '../types.js'

/** 切块参数。 */
export interface ChunkOptions {
  /** 每块目标大小（字符数）。调大：块更少、上下文全，但检索定位变粗；调小反之。 */
  size: number
  /** 相邻块重叠字符数；越大上下文越连贯，但重复内容越多。 */
  overlap: number
  /** 嵌入模型；只有 semantic 策略必须提供。 */
  embeddings?: Embeddings
}

/**
 * 切块统一入口：按策略分发到不同实现。
 * @param documents loadDocument 解析出的文档数组（含正文与元数据）
 * @param strategy 切块策略
 * @param options 块大小/重叠/嵌入模型
 * @returns 切好的片段数组（仍是 Document 形状，可直接送去向量化）
 */
export async function chunkDocuments(
  documents: LoadedChunk[],
  strategy: ChunkStrategy,
  options: ChunkOptions,
): Promise<LoadedChunk[]> {
  if (strategy === 'fixed') return fixedChunks(documents, options.size, options.overlap)
  if (strategy === 'semantic') return semanticChunks(documents, options)
  if (strategy === 'structure') return structureChunks(documents, options)
  // 兜底（含 'recursive'）：使用 LangChain 的递归字符切分器，
  // 它会尽量在段落、换行、句子边界处下刀，切出来的块语义更完整。
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options.size,
    chunkOverlap: options.overlap,
  })
  // splitDocuments 会保留原文档的 metadata；类型断言为本项目的 LoadedChunk。
  return (await splitter.splitDocuments(documents)) as LoadedChunk[]
}

/**
 * fixed 策略：按固定字符数“窗口滑动”切分。
 * 步长 = size - overlap：每块大小不变，相邻块之间有 overlap 个字符的重叠。
 */
function fixedChunks(documents: Document[], size: number, overlap: number): LoadedChunk[] {
  return documents.flatMap(document => {
    const chunks: LoadedChunk[] = []
    // start 是每块的起始下标；每次前进“块大小 - 重叠”。
    for (let start = 0; start < document.pageContent.length; start += size - overlap) {
      // 取出 [start, start+size) 的子串并去掉首尾空白。
      const pageContent = document.pageContent.slice(start, start + size).trim()
      // trim 后可能为空（整块都是空白），跳过空块。
      if (pageContent)
        chunks.push({
          pageContent,
          metadata: { ...document.metadata }, // 复制元数据，避免多个块共享同一引用
        } as LoadedChunk)
    }
    return chunks
  })
}

/**
 * semantic 策略：基于“相邻句子的向量相似度”切分。
 * 做法：先按句号/问号/感叹号把正文拆成句子并全部向量化，
 * 然后顺序扫描：相邻两句相似度低于阈值（话题变了）或当前块超长时，就断开另起一块。
 */
async function semanticChunks(
  documents: Document[],
  options: ChunkOptions,
): Promise<LoadedChunk[]> {
  // 语义切分必须调用嵌入模型，没传就直接报错（快速失败）。
  if (!options.embeddings) throw new Error('Semantic chunking requires an embeddings provider')
  const result: LoadedChunk[] = []
  for (const document of documents) {
    // 按中英文句末标点拆句；(?<=...) 是后行断言，保留标点在句子末尾，\s+ 吃掉句间空白。
    const sentences = document.pageContent.split(/(?<=[。！？.!?])\s+/).filter(Boolean)
    // 不足两句无法谈“相邻相似度”，整篇作为一个块返回。
    if (sentences.length < 2) {
      result.push(document as LoadedChunk)
      continue
    }
    // 一次性为所有句子生成向量（批处理比逐条调用快）。
    const vectors = await options.embeddings.embedDocuments(sentences)
    // current 累积当前块的文本，从第一句开始。
    let current = sentences[0]
    for (let index = 1; index < sentences.length; index++) {
      // 比较“上一句”和“当前句”的余弦相似度。
      const similarity = cosine(vectors[index - 1], vectors[index])
      // 相似度低于 0.72（话题切换）或合并后超过块大小：结束当前块、另起新块。
      if (similarity < 0.72 || current.length + sentences[index].length > options.size) {
        result.push({
          pageContent: current.trim(),
          metadata: { ...document.metadata },
        } as LoadedChunk)
        current = sentences[index]
      } else {
        // 语义连贯且没超长：把这句并入当前块（用空格连接）。
        current += ` ${sentences[index]}`
      }
    }
    // 循环结束后，把最后一个未提交的块补上。
    if (current.trim())
      result.push({
        pageContent: current.trim(),
        metadata: { ...document.metadata },
      } as LoadedChunk)
  }
  return result
}

/**
 * structure 策略：先按 Markdown 标题把正文分成“章节”，每个章节内部再做定长滑窗切分。
 * 切出的块会在 metadata.structure 中带上所属标题，便于展示“这段来自哪一节”。
 */
function structureChunks(documents: Document[], options: ChunkOptions): LoadedChunk[] {
  return documents.flatMap(document =>
    // (?=^#{1,6}\s) 匹配“行首 1~6 个 # 加空格”的位置（Markdown 标题），
    // 用“向前看”零宽匹配，split 后标题文字会保留在每节开头。
    document.pageContent.split(/(?=^#{1,6}\s)/m).flatMap(section => {
      const content = section.trim()
      // 文档开头还没出现标题时可能切出空串，跳过。
      if (!content) return []
      const chunks: LoadedChunk[] = []
      // 章节内继续按 size/overlap 做滑窗切分（同 fixed 策略）。
      for (let start = 0; start < content.length; start += options.size - options.overlap) {
        const pageContent = content.slice(start, start + options.size).trim()
        if (pageContent)
          chunks.push({
            pageContent,
            metadata: {
              ...document.metadata,
              // 兜底元数据：实验室预览场景没有真实文件信息时用 'preview'。
              source: String(document.metadata.source ?? 'preview'),
              fileName: String(document.metadata.fileName ?? 'preview'),
              // 正则提取该行 Markdown 标题文字（# 后面的内容），没有标题则为 undefined。
              structure: section.match(/^#{1,6}\s+(.+)/)?.[1],
            },
          } as LoadedChunk)
      }
      return chunks
    }),
  )
}

/**
 * 计算两个向量的余弦相似度：夹角越小（方向越一致）值越接近 1，正交时为 0。
 * 公式：(a·b) / (|a| × |b|)，即“内积除以各自长度的乘积”。
 */
function cosine(a: number[], b: number[]): number {
  // 分母 = 两个向量模长的乘积；模长 = 各分量平方和开根号。
  const denominator =
    Math.sqrt(a.reduce((sum, value) => sum + value * value, 0)) *
    Math.sqrt(b.reduce((sum, value) => sum + value * value, 0))
  // 零向量没有方向，无法计算夹角，约定相似度为 0。
  return denominator === 0
    ? 0
    : // 分子：对应分量相乘后求和（点积/内积）。
      a.reduce((sum, value, index) => sum + value * b[index], 0) / denominator
}
