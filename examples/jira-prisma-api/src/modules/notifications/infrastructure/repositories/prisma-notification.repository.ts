import { Repository, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type {
  INotificationRepository,
  NewNotification,
} from '../../domain/repositories/notification.repository'

import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class PrismaNotificationRepository implements INotificationRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.notification.findUnique({ where: { id } })
  }

  async findPaginated(parsed: ParsedQuery, recipientId: string) {
    const query = queryAdapter.build(parsed, { searchColumns: ['title', 'body'] })
    const where = query.where
      ? { AND: [query.where, { recipientId }] }
      : { recipientId }

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: query.orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.notification.count({ where }),
    ])

    return { data, total }
  }

  async create(data: NewNotification) {
    return this.prisma.notification.create({ data: data as any })
  }

  async markRead(id: string) {
    await this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    })
  }

  async markAllRead(recipientId: string) {
    await this.prisma.notification.updateMany({
      where: { recipientId, isRead: false },
      data: { isRead: true },
    })
  }

  async unreadCount(recipientId: string) {
    return this.prisma.notification.count({
      where: { recipientId, isRead: false },
    })
  }

  async delete(id: string) {
    await this.prisma.notification.delete({ where: { id } })
  }
}
