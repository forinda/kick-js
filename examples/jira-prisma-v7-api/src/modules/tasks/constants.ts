import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const TASK_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['status', 'priority', 'projectId', 'reporterId'],
  sortable: ['title', 'createdAt', 'updatedAt', 'priority', 'orderIndex'],
  searchable: ['title', 'key'],
}
