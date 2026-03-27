import type { TemplateContext } from './types'

export function generateConstants(ctx: TemplateContext): string {
  const { pascal } = ctx
  return `import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const ${pascal.toUpperCase()}_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['name'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
`
}
