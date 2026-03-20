export function generateConstants(pascal: string): string {
  return `import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const ${pascal.toUpperCase()}_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['name'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
`
}
