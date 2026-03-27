import { Repository, HttpException, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { IChannelRepository, NewChannel } from '../../domain/repositories/channel.repository'

import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class PrismaChannelRepository implements IChannelRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.channel.findUnique({ where: { id } })
  }

  async findPaginated(parsed: ParsedQuery, workspaceId: string) {
    const query = queryAdapter.build(parsed, { searchColumns: ['name'] })
    const where = query.where
      ? { AND: [query.where, { workspaceId }] }
      : { workspaceId }

    const [data, total] = await Promise.all([
      this.prisma.channel.findMany({
        where,
        orderBy: query.orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.channel.count({ where }),
    ])

    return { data, total }
  }

  async create(data: NewChannel) {
    return this.prisma.channel.create({ data: data as any })
  }

  async update(id: string, data: Partial<NewChannel>) {
    const channel = await this.prisma.channel
      .update({ where: { id }, data: data as any })
      .catch(() => null)
    if (!channel) throw HttpException.notFound('Channel not found')
    return channel
  }

  async delete(id: string) {
    await this.prisma.channel.delete({ where: { id } })
  }
}
