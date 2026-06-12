import { KickDbError } from '../errors'

export class MigrationError extends KickDbError {}

export class MigrationLockError extends MigrationError {
  constructor(message: string) {
    super('migration_lock_held', message)
  }
}

export interface SchemaDiffSummary {
  added: string[]
  removed: string[]
  changed: string[]
}

export class MigrationDriftError extends MigrationError {
  readonly diff: SchemaDiffSummary

  constructor(message: string, diff: SchemaDiffSummary) {
    super('migration_drift', message)
    this.diff = diff
  }
}

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
 * true` (CLI: `--confirm-enum-drop`). Spec:
 * docs/db/spec-enum-value-removal.md §4.
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
