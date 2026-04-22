import type { QueryParamsConfig } from '@forinda/kickjs'

export const WORKSPACE_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['ownerId'],
  sortable: ['name', 'createdAt'],
  searchable: ['name', 'slug'],
}
