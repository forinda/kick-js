import { Repository, HttpException, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@/generated/prisma/client'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { IMessageRepository, NewMessage } from '../../domain/repositories/message.repository'

import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class PrismaMessageRepository implements IMessageRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.message.findUnique({ where: { id } })
  }

  async findByChannel(channelId: string, cursor?: string, limit = 50) {
    return this.prisma.message.findMany({
      where: {
        channelId,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async findPaginated(parsed: ParsedQuery, channelId: string) {
    const query = queryAdapter.build(parsed, { searchColumns: ['content'] })
    const where = query.where
      ? { AND: [query.where, { channelId }] }
      : { channelId }

    const [data, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: query.orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.message.count({ where }),
    ])

    return { data, total }
  }

  async create(data: NewMessage) {
    return this.prisma.message.create({ data: data as any })
  }

  async update(id: string, data: Partial<NewMessage>) {
    const message = await this.prisma.message
      .update({ where: { id }, data: { ...data, isEdited: true } })
      .catch(() => null)
    if (!message) throw HttpException.notFound('Message not found')
    return message
  }

  async delete(id: string) {
    await this.prisma.message.delete({ where: { id } })
  }
}
