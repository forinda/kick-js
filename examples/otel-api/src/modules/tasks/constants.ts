import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const TASK_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['name'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
