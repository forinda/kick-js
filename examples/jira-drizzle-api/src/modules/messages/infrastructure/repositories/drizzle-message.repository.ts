import { eq, and, lt, sql, desc } from 'drizzle-orm'
import { Repository, HttpException, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { IMessageRepository, NewMessage } from '../../domain/repositories/message.repository'
import { messages } from '@/db/schema'
import { MESSAGE_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class DrizzleMessageRepository implements IMessageRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findById(id: string) {
    const [message] = await this.db.select().from(messages).where(eq(messages.id, id))
    return message ?? null
  }

  async findByChannel(channelId: string, cursor?: string, limit = 50) {
    const conditions = [eq(messages.channelId, channelId)]
    if (cursor) {
      conditions.push(lt(messages.createdAt, new Date(cursor)))
    }

    return this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
  }

  async findPaginated(parsed: ParsedQuery, channelId: string) {
    const query = queryAdapter.buildFromColumns(parsed, {
      ...MESSAGE_QUERY_CONFIG,
      baseCondition: eq(messages.channelId, channelId),
    })

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(messages)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(query.where),
    ])

    return { data, total: countResult[0]?.count ?? 0 }
  }

  async create(data: NewMessage) {
    const [message] = await this.db.insert(messages).values(data).returning()
    return message
  }

  async update(id: string, data: Partial<NewMessage>) {
    const [message] = await this.db
      .update(messages)
      .set({ ...data, isEdited: true })
      .where(eq(messages.id, id))
      .returning()
    if (!message) throw HttpException.notFound('Message not found')
    return message
  }

  async delete(id: string) {
    await this.db.delete(messages).where(eq(messages.id, id))
  }
}
