import { Repository, Inject, HttpException } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import { eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ParsedQuery } from '@forinda/kickjs-http'
import { projects } from '@/db/schema'
import type { IProjectRepository, NewProject } from '../../domain/repositories/project.repository'
import { PROJECT_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class DrizzleProjectRepository implements IProjectRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findById(id: string) {
    const [project] = await this.db.select().from(projects).where(eq(projects.id, id))
    return project ?? null
  }

  async findByWorkspace(workspaceId: string) {
    return this.db.select().from(projects).where(eq(projects.workspaceId, workspaceId))
  }

  async findPaginated(parsed: ParsedQuery, workspaceId?: string) {
    const query = queryAdapter.buildFromColumns(parsed, {
      ...PROJECT_QUERY_CONFIG,
      ...(workspaceId ? { baseCondition: eq(projects.workspaceId, workspaceId) } : {}),
    })

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(projects)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(projects)
        .where(query.where),
    ])

    return { data, total: countResult[0]?.count ?? 0 }
  }

  async create(dto: NewProject) {
    const [project] = await this.db.insert(projects).values(dto).returning()
    return project
  }

  async update(id: string, dto: Partial<NewProject>) {
    const [project] = await this.db.update(projects).set(dto).where(eq(projects.id, id)).returning()
    if (!project) throw HttpException.notFound('Project not found')
    return project
  }

  async incrementTaskCounter(id: string) {
    const [result] = await this.db
      .update(projects)
      .set({ taskCounter: sql`${projects.taskCounter} + 1` })
      .where(eq(projects.id, id))
      .returning({ taskCounter: projects.taskCounter, key: projects.key })
    return result
  }

  async delete(id: string) {
    await this.db.delete(projects).where(eq(projects.id, id))
  }
}
