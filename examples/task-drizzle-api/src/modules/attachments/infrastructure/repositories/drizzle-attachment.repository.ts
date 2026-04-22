import { eq, desc, sql } from 'drizzle-orm'
import { Repository, Inject } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ParsedQuery } from '@forinda/kickjs'
import type { IAttachmentRepository } from '../../domain/repositories/attachment.repository'
import { attachments } from '@/db/schema'
import { ATTACHMENT_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class DrizzleAttachmentRepository implements IAttachmentRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findById(id: string) {
    const [attachment] = await this.db.select().from(attachments).where(eq(attachments.id, id))
    return attachment ?? null
  }

  async findByTask(taskId: string) {
    return this.db
      .select()
      .from(attachments)
      .where(eq(attachments.taskId, taskId))
      .orderBy(desc(attachments.createdAt))
  }

  async findPaginated(parsed: ParsedQuery, taskId?: string) {
    const query = queryAdapter.buildFromColumns(parsed, {
      ...ATTACHMENT_QUERY_CONFIG,
      ...(taskId ? { baseCondition: eq(attachments.taskId, taskId) } : {}),
    })

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(attachments)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(attachments)
        .where(query.where),
    ])

    return { data, total: countResult[0]?.count ?? 0 }
  }

  async create(data: typeof attachments.$inferInsert) {
    const [attachment] = await this.db.insert(attachments).values(data).returning()
    return attachment
  }

  async delete(id: string) {
    await this.db.delete(attachments).where(eq(attachments.id, id))
  }
}
