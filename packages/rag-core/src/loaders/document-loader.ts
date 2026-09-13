import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Document } from '@langchain/core/documents'
import type { LoadedChunk } from '../types.js'

const supported = new Set(['.pdf', '.doc', '.docx', '.txt', '.md', '.markdown'])
const execFileAsync = promisify(execFile)

export async function loadDocument(filePath: string): Promise<LoadedChunk[]> {
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  if (!supported.has(extension)) throw new Error(`Unsupported document type: ${extension}`)
  const documents =
    extension === '.pdf'
      ? await loadPdf(filePath)
      : extension === '.docx'
        ? await loadDocx(filePath)
        : extension === '.doc'
          ? [
              new Document({
                pageContent: (
                  await execFileAsync('textutil', ['-convert', 'txt', '-stdout', filePath])
                ).stdout,
                metadata: {},
              }),
            ]
          : [new Document({ pageContent: await readFile(filePath, 'utf8'), metadata: {} })]
  if (documents.length === 0 || documents.every(document => !document.pageContent.trim())) {
    throw new Error('The document contains no readable text')
  }
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  return documents.map(document => ({
    ...document,
    metadata: { ...document.metadata, source: filePath, fileName },
  })) as LoadedChunk[]
}

async function loadDocx(filePath: string) {
  try {
    const { DocxLoader } = await import('@langchain/community/document_loaders/fs/docx')
    return await new DocxLoader(filePath).load()
  } catch (error) {
    // LangChain's loader uses the optional mammoth package. Fall back to the
    // DOCX XML payload so uploads still work when that optional package is absent.
    if (!String(error).toLowerCase().includes('mammoth')) throw error
    const xml = (await execFileAsync('unzip', ['-p', filePath, 'word/document.xml'])).stdout
    const text = xml
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    return [new Document({ pageContent: text, metadata: {} })]
  }
}

async function loadPdf(filePath: string) {
  try {
    const { PDFLoader } = await import('@langchain/community/document_loaders/fs/pdf')
    return await new PDFLoader(filePath, { splitPages: true }).load()
  } catch (error) {
    if (String(error).toLowerCase().includes('pdf-parse')) {
      throw new Error(
        'PDF parser is unavailable. Run `pnpm install` to install pdf-parse, then restart the API.',
      )
    }
    throw error
  }
}
