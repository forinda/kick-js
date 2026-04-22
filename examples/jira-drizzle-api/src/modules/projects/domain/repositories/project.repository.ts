import type { ParsedQuery } from '@forinda/kickjs'
import type { projects } from '@/db/schema'

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert

export interface IProjectRepository {
  findById(id: string): Promise<Project | null>
  findByWorkspace(workspaceId: string): Promise<Project[]>
  findPaginated(
    parsed: ParsedQuery,
    workspaceId?: string,
  ): Promise<{ data: Project[]; total: number }>
  create(dto: NewProject): Promise<Project>
  update(id: string, dto: Partial<NewProject>): Promise<Project>
  incrementTaskCounter(id: string): Promise<{ taskCounter: number; key: string }>
  delete(id: string): Promise<void>
}

export const PROJECT_REPOSITORY = Symbol('IProjectRepository')
