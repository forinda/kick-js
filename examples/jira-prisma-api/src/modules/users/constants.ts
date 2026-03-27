import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const USER_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['email', 'globalRole', 'isActive'],
  sortable: ['firstName', 'lastName', 'email', 'createdAt'],
  searchable: ['firstName', 'lastName', 'email'],
}
