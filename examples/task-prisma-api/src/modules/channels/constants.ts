import type { QueryParamsConfig } from '@forinda/kickjs'

export const CHANNEL_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['workspaceId', 'type'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
