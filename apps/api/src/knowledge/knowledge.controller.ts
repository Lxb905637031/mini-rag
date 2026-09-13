import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common'
import { IsNotEmpty, IsString } from 'class-validator'
import { KnowledgeService } from './knowledge.service.js'

class CreateKnowledgeDto {
  @IsString() @IsNotEmpty() name!: string
}

@Controller('knowledge-bases')
export class KnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly service: KnowledgeService) {}
  @Get() list() {
    return this.service.list()
  }
  @Post() create(@Body() body: CreateKnowledgeDto) {
    return this.service.create(body.name)
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.service.get(id)
  }
  @Delete(':id') remove(@Param('id') id: string) {
    return this.service.remove(id)
  }
}
