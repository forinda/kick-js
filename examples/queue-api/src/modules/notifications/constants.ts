import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const NOTIFICATION_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['name'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
