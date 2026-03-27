import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const LABEL_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['workspaceId'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
