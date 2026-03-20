import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const USERS_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['name', 'email', 'role'],
  sortable: ['name', 'email', 'createdAt'],
  searchable: ['name', 'email'],
}
