/**
 * `kick db push` — make a prototyping database match the schema with no
 * migration file. What it pushed is kept in the database (`kick_push`) and
 * diffed against next time: introspection is too lossy to diff from (SQLite
 * reads `uuid()` back as `text`), so it's only used to check nothing changed
 * the database in between.
 */
import { extractSnapshot } from '../snapshot/extract'
import { snapshotTableName } from '../snapshot/name'
import { diff, type RenameCandidates, type RenameHints } from '../diff/engine'
import { emitDdl, resolveRenames } from '../cli/generate'
import { checkDrift } from './drift'
import { MigrationDriftError, MigrationLockError } from './errors'
import type { Change } from '../diff/types'
import type { Casing } from '../snapshot/casing'
import type { SchemaSnapshot } from '../snapshot/types'
import type { MigrationAdapter } from './adapter'
import { KICK_PUSH_TABLE } from './schema'

const TABLE = KICK_PUSH_TABLE

export interface PushOptions {
  adapter: MigrationAdapter
  /** The schema module — what `createDbClient({ schema })` takes. */
  schema: Record<string, unknown>
  casing?: Casing
  /** Renames known up front. */
  renames?: RenameHints
  /** Asked which dropped tables and columns are really renames. */
  askRenames?: (candidates: RenameCandidates) => Promise<RenameHints>
  /**
   * Asked before changes that lose data (a dropped table or column, a
   * changed column type, a removed enum value). Without it, they're refused.
   */
  confirmDataLoss?: (losses: string[]) => Promise<boolean>
}

export interface PushResult {
  status: 'pushed' | 'no-changes'
  changeCount: number
}

/** What a change would lose, if anything. */
function dataLoss(c: Change): string | undefined {
  switch (c.kind) {
    case 'dropTable':
      return `drop table ${snapshotTableName(c.table)}`
    case 'dropColumn':
      return `drop column ${c.table}.${c.column.name}`
    case 'alterColumn':
      return c.before.type === c.after.type
        ? undefined
        : `change ${c.table}.${c.column} from ${c.before.type} to ${c.after.type}`
    case 'dropEnum':
      return `drop enum ${c.enum.name}`
    case 'removeEnumValue':
      return `remove ${c.removed.join(', ')} from enum ${c.enum}`
    default:
      return undefined
  }
}

async function readPushed(adapter: MigrationAdapter): Promise<SchemaSnapshot | undefined> {
  const db = adapter.kysely?.()
  if (!db) throw new Error('kickjs-db: push needs a migration adapter with kysely()')
  let row: { snapshot: string } | undefined
  try {
    row = await db.selectFrom(TABLE).select('snapshot').where('id', '=', 1).executeTakeFirst()
  } catch {
    return undefined // no kick_push table: nothing pushed yet
  }
  return row ? JSON.parse(Buffer.from(row.snapshot, 'hex').toString('utf8')) : undefined
}

/** The SQL that records `snapshot` as pushed — hex, so no dialect needs it quoted. */
function recordSql(snapshot: SchemaSnapshot): string {
  const hex = Buffer.from(JSON.stringify(snapshot), 'utf8').toString('hex')
  const text = snapshot.dialect === 'mysql' ? 'LONGTEXT' : 'TEXT'
  return [
    `CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY, snapshot ${text} NOT NULL);`,
    `DELETE FROM ${TABLE};`,
    `INSERT INTO ${TABLE} (id, snapshot) VALUES (1, '${hex}');`,
  ].join('\n')
}

function isEmpty(s: SchemaSnapshot): boolean {
  return (
    Object.keys(s.tables).length === 0 &&
    Object.keys(s.enums ?? {}).length === 0 &&
    Object.keys(s.views ?? {}).length === 0
  )
}

/**
 * Make the database match the schema, with no migration file — for
 * prototyping. Refused in production and on a database with migrations
 * applied: once a database has a migration history, changes go through
 * `kick db generate`.
 */
export async function pushSchema(opts: PushOptions): Promise<PushResult> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('kickjs-db: push is for prototyping — refused with NODE_ENV=production')
  }
  const { adapter } = opts
  await adapter.ensureMigrationTables()
  if ((await adapter.listApplied()).length > 0) {
    throw new Error(
      'kickjs-db: this database has migrations applied — change it with `kick db generate` and `kick db migrate latest`, not push',
    )
  }
  if (!(await adapter.acquireLock(`push ${process.pid}`))) {
    throw new MigrationLockError('Another process holds the migration lock.')
  }
  try {
    const live = await adapter.introspect()
    let prev = await readPushed(adapter)
    if (prev) {
      try {
        await checkDrift(live, prev, 'error')
      } catch (err) {
        if (!(err instanceof MigrationDriftError)) throw err
        throw new Error(
          `kickjs-db: the database changed since the last push, outside it — push won't guess what to keep. ${err.message}`,
          { cause: err },
        )
      }
    } else if (!isEmpty(live)) {
      throw new Error(
        "kickjs-db: push starts from an empty database or one it pushed to — this one has tables push didn't create",
      )
    } else {
      prev = { version: 1, dialect: adapter.dialect, tables: {} }
    }

    const target = extractSnapshot(opts.schema, adapter.dialect, { casing: opts.casing })
    // CONCURRENTLY can't run in push's transaction; a prototyping database doesn't need it.
    const changes = diff(prev, target, await resolveRenames(prev, target, opts)).map((c) =>
      (c.kind === 'addIndex' || c.kind === 'dropIndex') && c.index.concurrently
        ? { ...c, index: { ...c.index, concurrently: false } }
        : c,
    )
    if (changes.length === 0) return { status: 'no-changes', changeCount: 0 }

    const losses = changes.map(dataLoss).filter((l): l is string => l !== undefined)
    if (losses.length > 0 && !(await opts.confirmDataLoss?.(losses))) {
      throw new Error(
        `kickjs-db: push would lose data — ${losses.join('; ')}. Confirm it (--accept-data-loss), or name renames.`,
      )
    }

    // The schema change and the record of it commit together (Postgres,
    // SQLite; MySQL commits each DDL statement on its own).
    await adapter.applySqlInTx(
      `${emitDdl(adapter.dialect, changes, prev, target)}\n${recordSql(target)}`,
    )
    return { status: 'pushed', changeCount: changes.length }
  } finally {
    await adapter.releaseLock()
  }
}
