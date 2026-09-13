import { Body, Controller, Inject, Post } from '@nestjs/common'
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator'
import { ChatService } from './chat.service.js'

class QueryDto {
  @IsString() @IsNotEmpty() knowledgeBaseId!: string
  @IsString() @IsNotEmpty() query!: string
  @IsOptional() @IsIn(['vector', 'bm25', 'hybrid']) mode?: 'vector' | 'bm25' | 'hybrid'
  @IsOptional() @Min(1) @Max(20) topK?: number
  @IsOptional() @IsBoolean() rerank?: boolean
}

@Controller('chat')
export class ChatController {
  constructor(@Inject(ChatService) private readonly service: ChatService) {}
  @Post('query') query(@Body() body: QueryDto) {
    return this.service.query(body)
  }
}
