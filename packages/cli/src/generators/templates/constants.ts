export function generateConstants(pascal: string): string {
  return `import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const ${pascal.toUpperCase()}_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['name'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
`
}

export function generateDrizzleConstants(pascal: string, kebab: string): string {
  return `import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
// TODO: Import your schema table and reference actual columns for type safety
// import { ${kebab}s } from '@/db/schema'

export const ${pascal.toUpperCase()}_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    // Replace with actual Drizzle Column references for type-safe filtering:
    // name: ${kebab}s.name,
    // status: ${kebab}s.status,
  },
  sortable: {
    // name: ${kebab}s.name,
    // createdAt: ${kebab}s.createdAt,
  },
  searchColumns: [
    // ${kebab}s.name,
  ],
}
`
}
