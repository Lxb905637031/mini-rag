import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('uses local defaults', () => expect(loadConfig({}).chromaUrl).toBe('http://127.0.0.1:8000'))
  it('rejects overlap larger than chunk size', () =>
    expect(() => loadConfig({ RAG_CHUNK_SIZE: '100', RAG_CHUNK_OVERLAP: '100' })).toThrow())
})
