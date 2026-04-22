import type { ParsedQuery } from '@forinda/kickjs'
import type { Label } from '@prisma/client'

export type { Label }
export type NewLabel = {
  workspaceId: string
  name: string
  color: string
}

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
