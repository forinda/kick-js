import type { QueryParamsConfig } from '@forinda/kickjs'

export const HEALTH_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['name'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
