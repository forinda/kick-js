import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const ACTIVITY_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['workspaceId', 'actorId', 'action'],
  sortable: ['createdAt'],
  searchable: ['action'],
}
