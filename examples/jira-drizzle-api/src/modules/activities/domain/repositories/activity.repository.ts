import type { activities } from '@/db/schema'
import type { ParsedQuery } from '@forinda/kickjs-http'

export type Activity = typeof activities.$inferSelect
export type NewActivity = typeof activities.$inferInsert

export interface IActivityRepository {
  findPaginated(
    parsed: ParsedQuery,
    scope: { workspaceId: string; projectId?: string; taskId?: string },
  ): Promise<{ data: Activity[]; total: number }>
  create(data: NewActivity): Promise<Activity>
}

export const ACTIVITY_REPOSITORY = Symbol('IActivityRepository')
