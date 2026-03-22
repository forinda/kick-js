import { eq, and, sql } from 'drizzle-orm'
import { Repository, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type {
  INotificationRepository,
  NewNotification,
} from '../../domain/repositories/notification.repository'
import { notifications } from '@/db/schema'
import { NOTIFICATION_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class DrizzleNotificationRepository implements INotificationRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findById(id: string) {
    const [notification] = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
    return notification ?? null
  }

  async findPaginated(parsed: ParsedQuery, recipientId: string) {
    const query = queryAdapter.buildFromColumns(parsed, {
      ...NOTIFICATION_QUERY_CONFIG,
      baseCondition: eq(notifications.recipientId, recipientId),
    })

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(notifications)
        .where(query.where),
    ])

    return { data, total: countResult[0]?.count ?? 0 }
  }

  async create(data: NewNotification) {
    const [notification] = await this.db.insert(notifications).values(data).returning()
    return notification
  }

  async markRead(id: string) {
    await this.db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id))
  }

  async markAllRead(recipientId: string) {
    await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.recipientId, recipientId), eq(notifications.isRead, false)))
  }

  async unreadCount(recipientId: string) {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.recipientId, recipientId), eq(notifications.isRead, false)))
    return result?.count ?? 0
  }

  async delete(id: string) {
    await this.db.delete(notifications).where(eq(notifications.id, id))
  }
}
