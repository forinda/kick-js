import { Repository, Inject, HttpException } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import { eq, asc, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ParsedQuery } from '@forinda/kickjs'
import { tasks } from '@/db/schema'
import type { ITaskRepository, NewTask } from '../../domain/repositories/task.repository'
import { TASK_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class DrizzleTaskRepository implements ITaskRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findById(id: string) {
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, id))
    return task ?? null
  }

  async findByProject(projectId: string) {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.orderIndex))
  }

  async findPaginated(parsed: ParsedQuery, projectId?: string) {
    const query = queryAdapter.buildFromColumns(parsed, {
      ...TASK_QUERY_CONFIG,
      ...(projectId ? { baseCondition: eq(tasks.projectId, projectId) } : {}),
    })

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(tasks)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(query.where),
    ])

    return { data, total: countResult[0]?.count ?? 0 }
  }

  async findSubtasks(parentTaskId: string) {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.parentTaskId, parentTaskId))
      .orderBy(asc(tasks.orderIndex))
  }

  async create(dto: NewTask) {
    const [task] = await this.db.insert(tasks).values(dto).returning()
    return task
  }

  async update(id: string, dto: Partial<NewTask>) {
    const [task] = await this.db.update(tasks).set(dto).where(eq(tasks.id, id)).returning()
    if (!task) throw HttpException.notFound('Task not found')
    return task
  }

  async delete(id: string) {
    await this.db.delete(tasks).where(eq(tasks.id, id))
  }
}
