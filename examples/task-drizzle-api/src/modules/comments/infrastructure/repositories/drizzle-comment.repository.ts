import { eq, asc, sql } from 'drizzle-orm'
import { Repository, HttpException, Inject } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ParsedQuery } from '@forinda/kickjs'
import type { ICommentRepository, NewComment } from '../../domain/repositories/comment.repository'
import { comments } from '@/db/schema'
import { COMMENT_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class DrizzleCommentRepository implements ICommentRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findById(id: string) {
    const [comment] = await this.db.select().from(comments).where(eq(comments.id, id))
    return comment ?? null
  }

  async findByTask(taskId: string) {
    return this.db
      .select()
      .from(comments)
      .where(eq(comments.taskId, taskId))
      .orderBy(asc(comments.createdAt))
  }

  async findPaginated(parsed: ParsedQuery, taskId?: string) {
    const query = queryAdapter.buildFromColumns(parsed, {
      ...COMMENT_QUERY_CONFIG,
      ...(taskId ? { baseCondition: eq(comments.taskId, taskId) } : {}),
    })

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(comments)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(comments)
        .where(query.where),
    ])

    return { data, total: countResult[0]?.count ?? 0 }
  }

  async create(data: NewComment) {
    const [comment] = await this.db.insert(comments).values(data).returning()
    return comment
  }

  async update(id: string, data: Partial<NewComment>) {
    const [comment] = await this.db
      .update(comments)
      .set(data)
      .where(eq(comments.id, id))
      .returning()
    if (!comment) throw HttpException.notFound('Comment not found')
    return comment
  }

  async delete(id: string) {
    await this.db.delete(comments).where(eq(comments.id, id))
  }

  async countByTask(taskId: string) {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(comments)
      .where(eq(comments.taskId, taskId))
    return result?.count ?? 0
  }
}
