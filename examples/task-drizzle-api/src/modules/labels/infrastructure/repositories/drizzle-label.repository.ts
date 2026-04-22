import { eq, asc, sql } from 'drizzle-orm'
import { Repository, HttpException, Inject } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ParsedQuery } from '@forinda/kickjs'
import type { ILabelRepository, NewLabel } from '../../domain/repositories/label.repository'
import { labels } from '@/db/schema'
import { LABEL_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class DrizzleLabelRepository implements ILabelRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findById(id: string) {
    const [label] = await this.db.select().from(labels).where(eq(labels.id, id))
    return label ?? null
  }

  async findByWorkspace(workspaceId: string) {
    return this.db
      .select()
      .from(labels)
      .where(eq(labels.workspaceId, workspaceId))
      .orderBy(asc(labels.name))
  }

  async findPaginated(parsed: ParsedQuery, workspaceId?: string) {
    const query = queryAdapter.buildFromColumns(parsed, {
      ...LABEL_QUERY_CONFIG,
      ...(workspaceId ? { baseCondition: eq(labels.workspaceId, workspaceId) } : {}),
    })

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(labels)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(labels)
        .where(query.where),
    ])

    return { data, total: countResult[0]?.count ?? 0 }
  }

  async create(data: NewLabel) {
    const [label] = await this.db.insert(labels).values(data).returning()
    return label
  }

  async update(id: string, data: Partial<NewLabel>) {
    const [label] = await this.db.update(labels).set(data).where(eq(labels.id, id)).returning()
    if (!label) throw HttpException.notFound('Label not found')
    return label
  }

  async delete(id: string) {
    await this.db.delete(labels).where(eq(labels.id, id))
  }
}
