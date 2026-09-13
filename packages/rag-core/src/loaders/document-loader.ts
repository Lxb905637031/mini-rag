/**
 * @file packages/rag-core/src/loaders/document-loader.ts
 * @description 文档加载器：把磁盘上不同格式的文件解析成统一的 LangChain Document
 *              （{ pageContent: 纯文本, metadata }），供后续切块使用。
 *
 * 在 RAG 流水线中的位置：最前端。
 *   原始文件（PDF / Word / TXT / Markdown）→ 本文件解析为文本 → chunking 切块 → embedding
 *
 * 支持格式：.pdf / .doc / .docx / .txt / .md / .markdown
 * 注意：.doc 的解析调用 macOS 自带的 textutil 命令，因此该格式主要在 macOS 可用。
 */
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Document } from '@langchain/core/documents'
import type { LoadedChunk } from '../types.js'

// 允许解析的扩展名白名单。
const supported = new Set(['.pdf', '.doc', '.docx', '.txt', '.md', '.markdown'])
// 把回调风格的 execFile 转成 Promise 风格，方便 await（execFile 不会经过 shell，较安全）。
const execFileAsync = promisify(execFile)

/**
 * 加载并解析文档。
 * @param filePath 文件在磁盘上的绝对/相对路径
 * @returns Document 数组（PDF 按页可能返回多个，其它格式通常一个文件一个 Document）
 * @throws Error 文件类型不支持、或解析后没有任何可读文本时抛出
 */
export async function loadDocument(filePath: string): Promise<LoadedChunk[]> {
  // 取最后一个 '.' 之后的部分作为扩展名并转小写（.PDF 与 .pdf 一视同仁）。
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  if (!supported.has(extension)) throw new Error(`Unsupported document type: ${extension}`)

  // 按扩展名选择对应解析器（三元表达式链）。
  const documents =
    extension === '.pdf'
      ? await loadPdf(filePath)
      : extension === '.docx'
        ? await loadDocx(filePath)
        : extension === '.doc'
          ? // macOS 专属：调用系统自带 textutil，把旧版 .doc 转成纯文本输出到标准输出。
            [
              new Document({
                pageContent: (
                  await execFileAsync('textutil', ['-convert', 'txt', '-stdout', filePath])
                ).stdout,
                metadata: {},
              }),
            ]
          : // .txt / .md / .markdown 本身就是文本，直接按 UTF-8 读取即可。
            [
              new Document({
                pageContent: await readFile(filePath, 'utf8'),
                metadata: {},
              }),
            ]

  // 解析结果校验：没有文档、或所有文档都是空白，说明是扫描件/空文件等，无法入库。
  if (documents.length === 0 || documents.every(document => !document.pageContent.trim())) {
    throw new Error('The document contains no readable text')
  }

  // 取路径最后一段作为文件名（同时兼容 / 与 Windows 的 \ 分隔符）。
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  // 给每个 Document 补充统一元数据：source（完整路径）与 fileName（展示用）。
  return documents.map(document => ({
    ...document,
    metadata: { ...document.metadata, source: filePath, fileName },
  })) as LoadedChunk[]
}

/**
 * 解析 .docx（Word 2007+，本质是一个 zip 压缩包，里面是 XML）。
 * 优先用 LangChain 的 DocxLoader（底层依赖可选的 mammoth 包）；
 * 若环境缺少 mammoth，则降级为“unzip 取出 word/document.xml 后手动去标签”，
 * 保证上传功能在缺包时仍然可用。
 */
async function loadDocx(filePath: string) {
  try {
    // 动态 import：只有真的处理 docx 时才加载这个较重的依赖（按需加载，加快启动）。
    const { DocxLoader } = await import('@langchain/community/document_loaders/fs/docx')
    return await new DocxLoader(filePath).load()
  } catch (error) {
    // 仅当报错与缺少 mammoth 有关时才走兜底；其它错误（如文件损坏）继续向上抛。
    if (!String(error).toLowerCase().includes('mammoth')) throw error

    // unzip -p：把压缩包内 word/document.xml 的内容直接打印到标准输出。
    const xml = (await execFileAsync('unzip', ['-p', filePath, 'word/document.xml'])).stdout
    // 把 Word XML 粗略还原成纯文本：
    const text = xml
      .replace(/<w:tab[^>]*\/>/g, '\t') // 制表符标签 → Tab
      .replace(/<\/w:p>/g, '\n') // 段落结束标签 → 换行
      .replace(/<[^>]+>/g, '') // 删掉其余所有 XML 标签
      // 还原 XML 转义字符（顺序上 &amp; 必须先替换，否则会二次误伤）。
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    return [new Document({ pageContent: text, metadata: {} })]
  }
}

/**
 * 解析 PDF：使用 LangChain 的 PDFLoader，splitPages: true 表示每一页产出一个 Document
 * （页码会写入 metadata.page，后续生成答案时可以引用“来自第几页”）。
 */
async function loadPdf(filePath: string) {
  try {
    const { PDFLoader } = await import('@langchain/community/document_loaders/fs/pdf')
    return await new PDFLoader(filePath, { splitPages: true }).load()
  } catch (error) {
    // pdf-parse 是可选依赖；缺失时给出可操作的中文场景提示，而不是难懂的模块找不到错误。
    if (String(error).toLowerCase().includes('pdf-parse')) {
      throw new Error(
        'PDF parser is unavailable. Run `pnpm install` to install pdf-parse, then restart the API.',
      )
    }
    throw error
  }
}
