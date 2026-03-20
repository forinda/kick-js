import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const PRODUCTS_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['name', 'category', 'price', 'stock'],
  sortable: ['name', 'price', 'createdAt'],
  searchable: ['name', 'description', 'category'],
}
