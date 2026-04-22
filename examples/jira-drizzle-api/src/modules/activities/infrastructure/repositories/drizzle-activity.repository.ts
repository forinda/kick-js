import { eq, and, sql } from 'drizzle-orm'
import { Repository, Inject } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ParsedQuery } from '@forinda/kickjs'
import type {
  IActivityRepository,
  NewActivity,
} from '../../domain/repositories/activity.repository'
import { activities } from '@/db/schema'
import { ACTIVITY_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class DrizzleActivityRepository implements IActivityRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findPaginated(
    parsed: ParsedQuery,
    scope: { workspaceId: string; projectId?: string; taskId?: string },
  ) {
    const conditions = [eq(activities.workspaceId, scope.workspaceId)]
    if (scope.projectId) {
      conditions.push(eq(activities.projectId, scope.projectId))
    }
    if (scope.taskId) {
      conditions.push(eq(activities.taskId, scope.taskId))
    }

    const query = queryAdapter.buildFromColumns(parsed, {
      ...ACTIVITY_QUERY_CONFIG,
      baseCondition: and(...conditions),
    })

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(activities)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(activities)
        .where(query.where),
    ])

    return { data, total: countResult[0]?.count ?? 0 }
  }

  async create(data: NewActivity) {
    const [activity] = await this.db.insert(activities).values(data).returning()
    return activity
  }
}
