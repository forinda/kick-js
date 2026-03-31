import type { QueryParamsConfig } from '@forinda/kickjs'

export const CAT_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['name'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
