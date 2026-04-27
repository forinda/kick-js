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
      `Migration ${id} has -- REVIEWED: false; flip the marker before applying outside dev`,
    )
    this.id = id
  }
}
