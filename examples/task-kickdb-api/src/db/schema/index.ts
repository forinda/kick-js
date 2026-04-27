// Barrel — `import * as schema from './schema'` resolves here. Splitting
// tables across files exercises the multi-file SchemaToKysely<typeof schema>
// path: per-table modules contribute their own table refs, relations live
// alongside but are filtered out of `keyof DB` by the SchemaToKysely<S>
// `extends TableDecl<...>` clause.

export * from './users'
export * from './workspaces'
export * from './tasks'
export * from './categories'
export * from './relations'
