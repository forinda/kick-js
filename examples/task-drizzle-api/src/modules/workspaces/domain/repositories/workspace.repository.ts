import type { ParsedQuery } from '@forinda/kickjs'
import type { workspaces } from '@/db/schema'

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert

export interface IWorkspaceRepository {
  findById(id: string): Promise<Workspace | null>
  findBySlug(slug: string): Promise<Workspace | null>
  findForUser(userId: string): Promise<Workspace[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: Workspace[]; total: number }>
  create(dto: NewWorkspace): Promise<Workspace>
  update(id: string, dto: Partial<NewWorkspace>): Promise<Workspace>
  delete(id: string): Promise<void>
}

export const WORKSPACE_REPOSITORY = Symbol('IWorkspaceRepository')
