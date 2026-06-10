export type {
  Dialect,
  FkAction,
  ColumnSnapshot,
  IndexSnapshot,
  ForeignKeySnapshot,
  CheckSnapshot,
  TableSnapshot,
  EnumSnapshot,
  SchemaSnapshot,
} from './snapshot/types'

export { extractSnapshot } from './snapshot/extract'
export { renderSchemaSource } from './snapshot/render'

export type * from './diff/types'
export { diff } from './diff/engine'
export { invertChanges, hasAmbiguousReverse } from './diff/invert'
export {
  detectCompositeReferences,
  CompositeEnumReferenceError,
  type CompositeRef,
  type CompositeQueryRunner,
} from './diff/composite-detect'

export { KickDbError, RemovedValueAsDefaultError } from './errors'
export {
  MigrationError,
  MigrationLockError,
  MigrationDriftError,
  MigrationHashError,
  UnreviewedMigrationError,
  MigrationEnumDropError,
  type SchemaDiffSummary,
} from './migrate/errors'
export {
  parseEnumDropHeader,
  enforceEnumDropGate,
  type EnumDropHeader,
} from './migrate/enum-drop-gate'

export {
  readJournal,
  appendJournalEntry,
  computeMigrationHash,
  verifyMigrationHash,
  type Journal,
  type JournalEntry,
} from './migrate/journal'

export type { MigrationAdapter, MigrationRow } from './migrate/adapter'
export {
  migrationsTableDdl,
  lockTableDdl,
  KICK_MIGRATIONS_TABLE,
  KICK_LOCK_TABLE,
} from './migrate/schema'
export { MemoryMigrationAdapter } from './migrate/memory-adapter'
export { introspectPg } from './migrate/introspect-pg'
export type { IntrospectPgOptions, PgQueryRunner } from './migrate/introspect-types'
export { checkDrift, type DriftBehavior, type DriftLogger } from './migrate/drift'

export { kickDbAdapter, type KickDbAdapterConfig, type MigrationsOnBoot } from './adapter'

export { DB_PRIMARY, DB_REPLICA, DB_CLIENT } from './tokens'

export { createDbClient } from './client/create'
export { safeNullComparison } from './client/plugins'
export type {
  KickDbClient,
  KickDbClientEvents,
  QueryEvent,
  QueryErrorEvent,
  BeforeQueryEvent,
  TransactionEvent,
  TransactionRollbackEvent,
  CreateDbClientOptions,
} from './client/types'
export type { SchemaToTypes } from './client/schema-types'
export type { KickDbRegister, RegisteredDB } from './client/register'

// Kysely 0.29 narrowing helpers (M5.A.3). `$pickTables` / `$omitTables`
// are methods already reachable on KickDbClient via Kysely; re-exporting
// the type surfaces them on the bare `@forinda/kickjs-db` import path so
// adopters can declare read-only repos without dipping into `kysely/readonly`.
export type { ReadonlyKysely } from 'kysely/readonly'

export {
  migrateLatest,
  migrateUp,
  migrateDown,
  migrateRollback,
  migrateStatus,
  type RunnerOptions,
  type AppliedSummary,
  type ReversedSummary,
  type RollbackSummary,
  type StatusEntry,
} from './migrate/runner'
export { reviewMigration, type ReviewResult } from './migrate/review'

export { emitPg } from './emit/pg'
export { emitSqlite, SqliteRebuildRequiredError } from './emit/sqlite'

export { resolveDbConfig, type DbConfig } from './cli/config'
export { generate } from './cli/generate'
export type { GenerateOptions, GenerateResult } from './cli/generate'

export * from './dsl/columns'
export * from './dsl/table'
export * from './dsl/constraints'
export * from './dsl/relations'

// Adopter-defined column types (M2.F-T16) — lets projects introduce
// typed columns without forking the package.
export { customType, CustomColumnBuilder, type CustomTypeOptions } from './custom-type'

// Per-table method extensions (M2.F-T17) — `db.$extends({ model })`.
export type { ExtensionDefinition, ExtendedClient, ModelExtensions } from './extend/types'

// Relational query layer (M3.A) — `db.query.X.findMany({ with })`.
export type {
  KickDbRelationsRegister,
  RegisteredRelations,
  RelationMapEntry,
  TableRelations,
  FindManyOptions,
  FindManyRow,
  WithClause,
  QueryNamespace,
  TableQueryNamespace,
} from './query/types'
export type { ResolvedRelation, ResolvedRelations } from './query/relations'
export type { RelationSnapshot } from './snapshot/types'
export type { SchemaToRelationsRegister } from './query/schema-relations-types'
export {
  RelationalQueryUnknownRelationError,
  RelationalQueryDepthError,
  RelationalQueryAliasCollisionError,
  RelationalQueryAmbiguousRelationNameError,
  RelationalQueryMissingInverseError,
  RelationalQueryNotSupportedError,
  RelationalQueryCancelledError,
} from './query/errors'
