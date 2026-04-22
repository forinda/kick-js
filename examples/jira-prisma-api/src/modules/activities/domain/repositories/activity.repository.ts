import type { ParsedQuery } from '@forinda/kickjs'
import type { Activity } from '@prisma/client'

export type { Activity }
export type NewActivity = {
  workspaceId: string
  actorId: string
  action: string
  projectId?: string | null
  taskId?: string | null
  changes?: any
}

export interface IActivityRepository {
  findPaginated(
    parsed: ParsedQuery,
    scope: { workspaceId: string; projectId?: string; taskId?: string },
  ): Promise<{ data: Activity[]; total: number }>
  create(data: NewActivity): Promise<Activity>
}

export const ACTIVITY_REPOSITORY = Symbol('IActivityRepository')
