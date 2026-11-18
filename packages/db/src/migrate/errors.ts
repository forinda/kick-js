import { KickDbError } from '../errors'

/**
 * Base class for errors from the migration runner.
 *
 * @see https://kickjs.app/guide/database/errors#migrations
 */
export class MigrationError extends KickDbError {}

/**
 * Another process holds the migration lock (`code: 'migration_lock_held'`).
 *
 * @see https://kickjs.app/guide/database/migration-recovery#a-stuck-lock
 */
export class MigrationLockError extends MigrationError {
  constructor(message: string) {
    super('migration_lock_held', message)
  }
}

/** What a drift check found, by name: what the live database added, removed or changed. */
export interface SchemaDiffSummary {
  added: string[]
  removed: string[]
  changed: string[]
}

/**
 * The live database differs from the snapshot of the last applied migration
 * (`code: 'migration_drift'`). `diff` lists what differs.
 *
 * @see https://kickjs.app/guide/database/migration-recovery#drift
 */
export class MigrationDriftError extends MigrationError {
  readonly diff: SchemaDiffSummary

  constructor(message: string, diff: SchemaDiffSummary) {
    super('migration_drift', message)
    this.diff = diff
  }
}

/**
 * A migration's SQL failed to apply. Names the migration — with several
 * pending, the driver's own message ("no such table: …") doesn't say which —
 * and keeps the driver error as `cause`. The migration stays pending.
 */
export class MigrationFailedError extends MigrationError {
  readonly id: string

  constructor(id: string, cause: unknown) {
    super(
      'migration_failed',
      `Migration ${id} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    this.id = id
    this.cause = cause
  }
}

/**
 * A reviewed migration's files changed after review (`code: 'migration_hash_mismatch'`).
 * `expected` is the recorded hash, `actual` the files' current one.
 *
 * @see https://kickjs.app/guide/database/migration-recovery#hash-mismatch
 */
export class MigrationHashError extends MigrationError {
  readonly id: string
  readonly expected: string
  readonly actual: string

  constructor(id: string, expected: string, actual: string) {
    super('migration_hash_mismatch', `Hash mismatch for migration ${id}`)
    this.id = id
    this.expected = expected
    this.actual = actual
  }
}

/**
 * A migration not marked reviewed was about to run while `requireReviewed` is on
 * (`code: 'migration_unreviewed'`). Run `kick db migrate review <id>` first.
 *
 * @see https://kickjs.app/guide/database/migration-recovery#unreviewed-migration
 */
export class UnreviewedMigrationError extends MigrationError {
  readonly id: string

  constructor(id: string) {
    super(
      'migration_unreviewed',
      `Migration ${id} is unreviewed (meta.json reviewed: false) — run \`kick db migrate review ${id}\` before applying outside dev`,
    )
    this.id = id
  }
}

/**
 * Thrown by the runner when a migration carries the `-- KICK ENUM
 * REMOVE` header and the operator hasn't passed `confirmEnumDrop:
 * true` (CLI: `--confirm-enum-drop`).
 */
export class MigrationEnumDropError extends MigrationError {
  readonly id: string
  readonly enums: readonly string[]
  readonly removed: readonly string[]
  readonly columns: readonly string[]

  constructor(
    id: string,
    enums: readonly string[],
    removed: readonly string[],
    columns: readonly string[],
  ) {
    const enumList = enums.join(', ')
    const valueList = removed.join(', ')
    super(
      'migration_enum_drop_unconfirmed',
      `Migration ${id} drops value(s) ${valueList} from PostgreSQL enum(s) ${enumList}. ` +
        `Re-run with \`--confirm-enum-drop\` (CLI) or \`confirmEnumDrop: true\` ` +
        `(RunnerOptions) after reviewing the column-USING clauses in up.sql.`,
    )
    this.id = id
    this.enums = enums
    this.removed = removed
    this.columns = columns
  }
}
