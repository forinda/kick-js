import type { ParsedQuery } from '@forinda/kickjs-http'
import type { Workspace } from '@/generated/prisma/client'

export type { Workspace }

export interface IWorkspaceRepository {
  findById(id: string): Promise<Workspace | null>
  findBySlug(slug: string): Promise<Workspace | null>
  findForUser(userId: string): Promise<Workspace[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: Workspace[]; total: number }>
  create(dto: any): Promise<Workspace>
  update(id: string, dto: any): Promise<Workspace>
  delete(id: string): Promise<void>
}

export const WORKSPACE_REPOSITORY = Symbol('IWorkspaceRepository')
