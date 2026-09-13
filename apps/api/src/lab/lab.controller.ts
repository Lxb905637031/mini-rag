/**
 * @file apps/api/src/lab/lab.controller.ts
 * @description “检索实验室”接口：不经过文件上传和数据库，直接对一段文本试切块，
 *              用来直观对比不同切块策略/参数的效果。
 *
 * 路由：POST /lab/chunks
 * 数据流：前端粘贴文本 → DTO 校验 → 调用核心库 chunkDocuments → 返回切片与耗时。
 */
import { Body, Controller, Post } from '@nestjs/common'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator'
import { chunkDocuments, createOllamaEmbeddings, loadConfig } from '@mini-rag/core'

/** 切块预览请求体。 */
class ChunkPreviewDto {
  // 必填、非空：待实验的原文。
  @IsString()
  @IsNotEmpty()
  text!: string

  // 必填：切块策略，四选一。
  // fixed=按固定长度硬切；recursive=递归地优先按段落/句子边界切（默认推荐）；
  // semantic=借助嵌入模型按语义相似度切分；structure=按文档结构（标题等）切。
  @IsIn(['fixed', 'recursive', 'semantic', 'structure'])
  strategy!: 'fixed' | 'recursive' | 'semantic' | 'structure'

  // 可选：目标块大小（字符数），限定 100~4000，防止填 0 或超大值。
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(4000)
  size?: number
}

@Controller('lab')
export class LabController {
  /**
   * 预览切块结果。
   * @returns chunks 切出的片段数组；durationMs 本次切块耗时（毫秒）
   */
  @Post('chunks')
  async preview(@Body() body: ChunkPreviewDto) {
    const config = loadConfig()
    // 记录开始时间戳，用于计算耗时。
    const started = Date.now()
    // 把实验文本伪装成一个“已加载文档”喂给切块函数；source 标记为 preview。
    const chunks = await chunkDocuments(
      [{ pageContent: body.text, metadata: { source: 'preview', fileName: '实验文本' } }],
      body.strategy,
      {
        // 块大小：前端没传时用 500 字符做实验默认值。
        size: body.size ?? 500,
        // 相邻块固定重叠 60 字符，保证边界处上下文连贯。
        overlap: 60,
        // 只有 semantic 策略才需要嵌入模型（语义切分要比较相邻句子向量）；
        // 其它策略传 undefined，避免无谓地启动模型调用。
        embeddings: body.strategy === 'semantic' ? createOllamaEmbeddings(config) : undefined,
      },
    )
    return { chunks, durationMs: Date.now() - started }
  }
}
