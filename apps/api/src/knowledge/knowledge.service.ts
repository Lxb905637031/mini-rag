import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'

@Injectable()
export class KnowledgeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  list() {
    return this.prisma.knowledgeBase.findMany({
      include: { _count: { select: { documents: true } } },
      orderBy: { updatedAt: 'desc' },
    })
  }
  async create(name: string) {
    return this.prisma.knowledgeBase.create({ data: { name } })
  }
  async get(id: string) {
    const item = await this.prisma.knowledgeBase.findUnique({
      where: { id },
      include: { documents: true },
    })
    if (!item) throw new NotFoundException('Knowledge base not found')
    return item
  }
  async remove(id: string) {
    await this.get(id)
    return this.prisma.knowledgeBase.delete({ where: { id } })
  }
}
