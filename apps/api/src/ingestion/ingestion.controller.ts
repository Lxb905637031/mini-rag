import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { IngestionService } from './ingestion.service.js'

@Controller('knowledge-bases/:knowledgeBaseId/documents')
export class IngestionController {
  constructor(@Inject(IngestionService) private readonly service: IngestionService) {}
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, callback) =>
        callback(null, /\.(pdf|doc|docx|txt|md|markdown)$/i.test(file.originalname)),
    }),
  )
  upload(@Param('knowledgeBaseId') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file)
      throw new BadRequestException('Only PDF, DOC, DOCX, TXT and Markdown files are supported')
    return this.service.upload(id, file)
  }
  @Get() list(@Param('knowledgeBaseId') id: string) {
    return this.service.list(id)
  }
  @Get(':documentId/chunks') chunks(@Param('documentId') id: string) {
    return this.service.chunks(id)
  }
  @Delete(':documentId') remove(@Param('documentId') id: string) {
    return this.service.remove(id)
  }
}
