import type { QueryParamsConfig } from '@forinda/kickjs'

export const LABEL_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['workspaceId'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
