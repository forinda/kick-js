import { eq, sql } from 'drizzle-orm'
import { Repository, HttpException, Inject } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ParsedQuery } from '@forinda/kickjs'
import type { IChannelRepository, NewChannel } from '../../domain/repositories/channel.repository'
import { channels } from '@/db/schema'
import { CHANNEL_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class DrizzleChannelRepository implements IChannelRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findById(id: string) {
    const [channel] = await this.db.select().from(channels).where(eq(channels.id, id))
    return channel ?? null
  }

  async findPaginated(parsed: ParsedQuery, workspaceId: string) {
    const query = queryAdapter.buildFromColumns(parsed, {
      ...CHANNEL_QUERY_CONFIG,
      baseCondition: eq(channels.workspaceId, workspaceId),
    })

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(channels)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(channels)
        .where(query.where),
    ])

    return { data, total: countResult[0]?.count ?? 0 }
  }

  async create(data: NewChannel) {
    const [channel] = await this.db.insert(channels).values(data).returning()
    return channel
  }

  async update(id: string, data: Partial<NewChannel>) {
    const [channel] = await this.db
      .update(channels)
      .set(data)
      .where(eq(channels.id, id))
      .returning()
    if (!channel) throw HttpException.notFound('Channel not found')
    return channel
  }

  async delete(id: string) {
    await this.db.delete(channels).where(eq(channels.id, id))
  }
}
