import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { tasks } from '@/db/schema'

export const TASK_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    projectId: tasks.projectId,
    workspaceId: tasks.workspaceId,
    status: tasks.status,
    priority: tasks.priority,
    reporterId: tasks.reporterId,
    parentTaskId: tasks.parentTaskId,
  },
  sortable: {
    title: tasks.title,
    status: tasks.status,
    priority: tasks.priority,
    dueDate: tasks.dueDate,
    orderIndex: tasks.orderIndex,
    createdAt: tasks.createdAt,
  },
  searchColumns: [tasks.title, tasks.key],
}
