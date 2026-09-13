/**
 * @file packages/rag-core/src/embeddings/ollama-embeddings.ts
 * @description 嵌入模型（embeddings）的创建工厂：负责把“文字”变成“向量”。
 *
 * 小白导读：
 * - 什么是 embedding（嵌入向量）？可以把一段文字想象成高维空间里的一个点，这个点由一长串数字组成
 *   （例如 mxbai-embed-large 模型输出 1024 个数字，即 1024 维）。含义相近的文字，对应的点距离也近。
 * - 什么是相似度检索？把用户的问题也转成一个向量，去向量数据库里找“距离最近”的若干文档片段，
 *   这就是语义检索：哪怕文档里没有出现问题中的原词，只要意思接近也能被找到，弥补了纯关键词匹配的不足。
 * - 本项目通过本地 Ollama 服务完成向量计算：Ollama 在本机启动一个 HTTP 服务（默认 11434 端口），
 *     LangChain 的 OllamaEmbeddings 类会把文本用 HTTP 请求发给 Ollama，再拿回计算好的向量。
 *
 * 在整条 RAG 链路中的位置：
 * - 写入（摄入）链路：文档加载 → 切块（chunking）→【本文件创建的模型把每个块转向量】→ 存入 Chroma；
 * - 查询（问答）链路：用户问题 →【同一个模型把问题转向量】→ Chroma 相似度检索 → 融合 / 重排 → 大模型生成答案。
 * - 关键约束：入库和提问必须使用同一个嵌入模型，否则两批向量不在同一个“坐标系”里，距离比较毫无意义；
 *   更换嵌入模型后必须重新摄入全部文档（重建向量库）。
 *
 * 异常与降级：本文件只负责“创建对象”，创建时并不发起网络请求，所以这里不会因连不上 Ollama 而报错；
 * 真正的连接错误（Ollama 没启动、端口不对、模型没有 ollama pull）会延迟到之后真正计算向量时才抛出。
 */
import { OllamaEmbeddings } from '@langchain/ollama'
import type { RagConfig } from '../types.js'

/**
 * 创建一个基于本地 Ollama 的嵌入模型实例（工厂函数）。
 *
 * 为什么用工厂函数：把“如何构造 OllamaEmbeddings、需要哪些配置”集中在这一处，
 * 上层（rag.ts / ingestion）只管用统一配置拿到模型，不需要了解第三方类的构造细节。
 *
 * @param config 全局配置对象（RagConfig），本函数只读取其中两个字段：
 *   - ollamaBaseUrl：Ollama 服务地址，例如 http://127.0.0.1:11434；
 *   - embeddingModel：嵌入模型名称，例如 mxbai-embed-large，必须是本机 Ollama 已拉取的模型。
 * @returns LangChain 标准的 OllamaEmbeddings 实例，可传给向量库写入文档，也可在检索时把问题转向量。
 */
export function createOllamaEmbeddings(config: RagConfig): OllamaEmbeddings {
  // baseUrl 决定 HTTP 请求发到哪里；model 决定调用哪个嵌入模型来计算向量。
  return new OllamaEmbeddings({ baseUrl: config.ollamaBaseUrl, model: config.embeddingModel })
}
