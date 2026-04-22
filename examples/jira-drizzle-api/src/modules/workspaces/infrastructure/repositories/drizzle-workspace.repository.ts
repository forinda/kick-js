import { Repository, Inject, HttpException } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import { eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ParsedQuery } from '@forinda/kickjs'
import { workspaces, workspaceMembers } from '@/db/schema'
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository'
import { WORKSPACE_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class DrizzleWorkspaceRepository implements IWorkspaceRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findById(id: string) {
    const [workspace] = await this.db.select().from(workspaces).where(eq(workspaces.id, id))
    return workspace ?? null
  }

  async findBySlug(slug: string) {
    const [workspace] = await this.db.select().from(workspaces).where(eq(workspaces.slug, slug))
    return workspace ?? null
  }

  async findForUser(userId: string) {
    return this.db
      .select({ workspace: workspaces })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId))
      .then((rows) => rows.map((r) => r.workspace))
  }

  async findPaginated(parsed: ParsedQuery) {
    const query = queryAdapter.buildFromColumns(parsed, WORKSPACE_QUERY_CONFIG)

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(workspaces)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(workspaces)
        .where(query.where),
    ])

    return { data, total: countResult[0]?.count ?? 0 }
  }

  async create(dto: any) {
    const [workspace] = await this.db.insert(workspaces).values(dto).returning()
    return workspace
  }

  async update(id: string, dto: any) {
    const [workspace] = await this.db
      .update(workspaces)
      .set(dto)
      .where(eq(workspaces.id, id))
      .returning()
    if (!workspace) throw HttpException.notFound('Workspace not found')
    return workspace
  }

  async delete(id: string) {
    await this.db.delete(workspaces).where(eq(workspaces.id, id))
  }
}
