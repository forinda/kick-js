import type { workspaceMembers } from '@/db/schema'

export type WorkspaceMember = typeof workspaceMembers.$inferSelect
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert

export interface IWorkspaceMemberRepository {
  findByWorkspaceAndUser(workspaceId: string, userId: string): Promise<WorkspaceMember | null>
  listByWorkspace(workspaceId: string): Promise<any[]>
  listByUser(userId: string): Promise<WorkspaceMember[]>
  add(data: NewWorkspaceMember): Promise<WorkspaceMember>
  updateRole(workspaceId: string, userId: string, role: string): Promise<WorkspaceMember>
  remove(workspaceId: string, userId: string): Promise<void>
}

export const WORKSPACE_MEMBER_REPOSITORY = Symbol('IWorkspaceMemberRepository')
