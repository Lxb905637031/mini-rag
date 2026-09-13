import { Module } from '@nestjs/common'
import { PrismaModule } from './prisma/prisma.module.js'
import { KnowledgeController } from './knowledge/knowledge.controller.js'
import { KnowledgeService } from './knowledge/knowledge.service.js'
import { IngestionController } from './ingestion/ingestion.controller.js'
import { IngestionService } from './ingestion/ingestion.service.js'
import { ChatController } from './chat/chat.controller.js'
import { ChatService } from './chat/chat.service.js'
import { HealthController } from './health/health.controller.js'
import { LabController } from './lab/lab.controller.js'

@Module({
  imports: [PrismaModule],
  controllers: [
    KnowledgeController,
    IngestionController,
    ChatController,
    HealthController,
    LabController,
  ],
  providers: [KnowledgeService, IngestionService, ChatService],
})
export class AppModule {}
