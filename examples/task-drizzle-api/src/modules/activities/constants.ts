import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { activities } from '@/db/schema'

export const ACTIVITY_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    workspaceId: activities.workspaceId,
    projectId: activities.projectId,
    taskId: activities.taskId,
    actorId: activities.actorId,
    action: activities.action,
  },
  sortable: {
    createdAt: activities.createdAt,
  },
  searchColumns: [activities.action],
}
