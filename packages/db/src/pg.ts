// `@forinda/kickjs-db/pg` — everything PostgreSQL-specific: the PG-only
// column types (tsvector, vector, citext, …) plus the migration adapter
// and Kysely dialect. `pg` is an optional peer dependency of
// `@forinda/kickjs-db` — install it alongside to use this subpath.
export * from './dsl/columns/pg'
// Named-schema namespaces (`pgSchema('billing').table(...)`). PG-only, so it
// lives on this subpath rather than the dialect-neutral root barrel.
export * from './dsl/pg-schema'
export * from './adapters/pg/adapter'
export * from './adapters/pg/dialect'
