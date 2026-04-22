import type { QueryParamsConfig } from '@forinda/kickjs'

export const PROJECT_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['workspaceId', 'isArchived'],
  sortable: ['name', 'createdAt', 'updatedAt'],
  searchable: ['name', 'key'],
}
