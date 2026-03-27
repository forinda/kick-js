import { Repository, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import { eq, and } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { workspaceMembers, users } from '@/db/schema'
import type {
  IWorkspaceMemberRepository,
  NewWorkspaceMember,
} from '../../domain/repositories/workspace-member.repository'

@Repository()
export class DrizzleWorkspaceMemberRepository implements IWorkspaceMemberRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findByWorkspaceAndUser(workspaceId: string, userId: string) {
    const [member] = await this.db
      .select()
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      )
    return member ?? null
  }

  async listByWorkspace(workspaceId: string) {
    return this.db
      .select({
        member: workspaceMembers,
        user: {
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
  }

  async listByUser(userId: string) {
    return this.db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId))
  }

  async add(data: NewWorkspaceMember) {
    const [member] = await this.db.insert(workspaceMembers).values(data).returning()
    return member
  }

  async updateRole(workspaceId: string, userId: string, role: string) {
    const [member] = await this.db
      .update(workspaceMembers)
      .set({ role: role as any })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      )
      .returning()
    return member
  }

  async remove(workspaceId: string, userId: string) {
    await this.db
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      )
  }
}
