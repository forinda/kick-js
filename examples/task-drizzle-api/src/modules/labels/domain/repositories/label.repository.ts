import type { labels } from '@/db/schema'
import type { ParsedQuery } from '@forinda/kickjs'

export type Label = typeof labels.$inferSelect
export type NewLabel = typeof labels.$inferInsert

export interface ILabelRepository {
  findById(id: string): Promise<Label | null>
  findByWorkspace(workspaceId: string): Promise<Label[]>
  findPaginated(
    parsed: ParsedQuery,
    workspaceId?: string,
  ): Promise<{ data: Label[]; total: number }>
  create(data: NewLabel): Promise<Label>
  update(id: string, data: Partial<NewLabel>): Promise<Label>
  delete(id: string): Promise<void>
}

export const LABEL_REPOSITORY = Symbol('ILabelRepository')
