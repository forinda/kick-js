export type {
  Dialect,
  FkAction,
  ColumnSnapshot,
  IndexSnapshot,
  ForeignKeySnapshot,
  CheckSnapshot,
  TableSnapshot,
  SchemaSnapshot,
} from './snapshot/types'

export { extractSnapshot } from './snapshot/extract'

export type * from './diff/types'
export { diff } from './diff/engine'
export { invertChanges, hasAmbiguousReverse } from './diff/invert'

export { KickDbError } from './errors'
export {
  MigrationError,
  MigrationLockError,
  MigrationDriftError,
  MigrationHashError,
  UnreviewedMigrationError,
  type SchemaDiffSummary,
} from './migrate/errors'

export {
  readJournal,
  appendJournalEntry,
  computeMigrationHash,
  verifyMigrationHash,
  type Journal,
  type JournalEntry,
} from './migrate/journal'

export { emitPg } from './emit/pg'

export { resolveDbConfig, type DbConfig } from './cli/config'
export { generate } from './cli/generate'
export type { GenerateOptions, GenerateResult } from './cli/generate'

export * from './dsl/columns'
export * from './dsl/table'
export * from './dsl/constraints'
export * from './dsl/relations'
