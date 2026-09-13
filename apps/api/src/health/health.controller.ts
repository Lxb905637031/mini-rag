import { Controller, Get } from '@nestjs/common'
import { loadConfig } from '@mini-rag/core'

@Controller('health')
export class HealthController {
  @Get() check() {
    const config = loadConfig()
    return {
      ok: true,
      services: { ollama: config.ollamaBaseUrl, chroma: config.chromaUrl, database: 'sqlite' },
    }
  }
}
