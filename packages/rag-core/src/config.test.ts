/**
 * @file packages/rag-core/src/config.test.ts
 * @description 配置加载器 loadConfig 的单元测试（Vitest）。
 *
 * 这里利用了 loadConfig 支持“传入自定义环境变量对象”的设计：
 * 测试时直接传 {} 或指定键值，无需真正修改系统环境变量，互相隔离、可重复运行。
 */
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  // 用例 1：一个环境变量都不传时，应使用本地开发的默认值（Chroma 默认地址）。
  it('uses local defaults', () => expect(loadConfig({}).chromaUrl).toBe('http://127.0.0.1:8000'))

  // 用例 2：非法参数组合要在启动阶段就抛错——重叠长度不允许大于等于块大小。
  it('rejects overlap larger than chunk size', () =>
    expect(() => loadConfig({ RAG_CHUNK_SIZE: '100', RAG_CHUNK_OVERLAP: '100' })).toThrow())
})
