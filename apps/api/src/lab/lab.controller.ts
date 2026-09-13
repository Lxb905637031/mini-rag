import { Body, Controller, Post } from '@nestjs/common'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator'
import { chunkDocuments, createOllamaEmbeddings, loadConfig } from '@mini-rag/core'

class ChunkPreviewDto {
  @IsString() @IsNotEmpty() text!: string
  @IsIn(['fixed', 'recursive', 'semantic', 'structure']) strategy!:
    'fixed' | 'recursive' | 'semantic' | 'structure'
  @IsOptional() @IsInt() @Min(100) @Max(4000) size?: number
}

@Controller('lab')
export class LabController {
  @Post('chunks') async preview(@Body() body: ChunkPreviewDto) {
    const config = loadConfig()
    const started = Date.now()
    const chunks = await chunkDocuments(
      [{ pageContent: body.text, metadata: { source: 'preview', fileName: '实验文本' } }],
      body.strategy,
      {
        size: body.size ?? 500,
        overlap: 60,
        embeddings: body.strategy === 'semantic' ? createOllamaEmbeddings(config) : undefined,
      },
    )
    return { chunks, durationMs: Date.now() - started }
  }
}
