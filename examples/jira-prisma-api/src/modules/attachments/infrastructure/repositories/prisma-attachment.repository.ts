import { Repository, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { IAttachmentRepository } from '../../domain/repositories/attachment.repository'
import { ATTACHMENT_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class PrismaAttachmentRepository implements IAttachmentRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.attachment.findUnique({ where: { id } })
  }

  async findByTask(taskId: string) {
    return this.prisma.attachment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findPaginated(parsed: ParsedQuery, taskId?: string) {
    const query = queryAdapter.build(parsed, ATTACHMENT_QUERY_CONFIG)
    const where = taskId
      ? query.where
        ? { AND: [query.where, { taskId }] }
        : { taskId }
      : query.where

    const [data, total] = await Promise.all([
      this.prisma.attachment.findMany({
        where,
        orderBy: query.orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.attachment.count({ where }),
    ])

    return { data, total }
  }

  async create(data: any) {
    return this.prisma.attachment.create({ data })
  }

  async delete(id: string) {
    await this.prisma.attachment.delete({ where: { id } })
  }
}
