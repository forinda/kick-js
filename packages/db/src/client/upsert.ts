/**
 * `db.upsert()` and `db.findOrCreate()` — insert-or-update and
 * find-or-insert with one call on every dialect.
 */
import {
  sql,
  type Expression,
  type ExpressionBuilder,
  type Insertable,
  type Selectable,
  type SqlBool,
  type UpdateObject,
} from 'kysely'
import { UniqueViolationError } from '../db-errors'
import { MAX_PARAMS, chunksFor, inChunks, type InsertManyOptions } from './insert-many'
import type { KickDbClient } from './types'

type Row = Record<string, unknown>

export interface UpsertOptions<DB, T extends keyof DB & string> extends InsertManyOptions {
  /**
   * The row — or rows — to insert. Many rows are split into statements that
   * fit the dialect's parameter limit, in one transaction (see `insertMany`).
   */
  values: Insertable<DB[T]> | ReadonlyArray<Insertable<DB[T]>>
  /**
   * The unique key (or primary key) whose conflict turns the insert into an
   * update. On MySQL, any unique key conflicts — MySQL has no target; this is
   * still used to read the rows back.
   */
  target: ReadonlyArray<keyof DB[T] & string>
  /**
   * What to update on a conflict: column names take the incoming row's value
   * (the default is every inserted column outside `target`); an object sets
   * values or expressions — ``{ views: sql`page_views.views + 1` }``.
   * `false` leaves a conflicting row as it is (`ON CONFLICT DO NOTHING`) and
   * returns it as stored.
   */
  update?: ReadonlyArray<keyof DB[T] & string> | UpdateObject<DB, T> | false
  /**
   * The predicate of a partial unique index `target` refers to (Postgres,
   * SQLite). Write it as the index does, with literals — ``() => sql`active = 1` ``:
   * the database matches it against the index, and a bound parameter can't be.
   */
  where?: (eb: ExpressionBuilder<DB, T>) => Expression<SqlBool>
}

/** The keys `where` always has — an optional one may be missing. */
type PresentKeys<W> = { [K in keyof W]-?: {} extends Pick<W, K> ? never : K }[keyof W]

/** What `create` adds to `where`: every required column `where` may leave out. */
type CreateRest<DB, T extends keyof DB, W> = Omit<Insertable<DB[T]>, PresentKeys<W>> &
  Partial<Insertable<DB[T]>>

export type FindOrCreateOptions<
  DB,
  T extends keyof DB & string,
  W extends Partial<Selectable<DB[T]>> = Partial<Selectable<DB[T]>>,
> = {
  /** Identifies the row — columns of a unique key. Also part of what's created. */
  where: W & Record<Exclude<keyof W, keyof Selectable<DB[T]>>, never>
} & ({} extends CreateRest<DB, T, W>
  ? /** The rest of the row to create when none matches `where`. */
    { create?: CreateRest<DB, T, W> }
  : { create: CreateRest<DB, T, W> })

/**
 * Insert `values`, or update the rows whose `target` already exists. Returns
 * the rows as stored. `tenant` is the table's tenant column and the current
 * tenant: tenancy fills that column on insert, so a row that leaves it out is
 * read back by the current tenant.
 */
export async function upsert<DB, T extends keyof DB & string>(
  db: KickDbClient<DB>,
  table: T,
  opts: UpsertOptions<DB, T>,
  tenant?: { column: string; id: string },
): Promise<Selectable<DB[T]>[]> {
  const rows = (Array.isArray(opts.values) ? opts.values : [opts.values]) as Row[]
  if (rows.length === 0) return []
  /** A row's value for a target column, the tenant's when tenancy fills it. */
  const key = (r: Row, c: string) => (c === tenant?.column ? (r[c] ?? tenant.id) : r[c])
  const statement = (chunk: Row[]) => upsertStatement(db, table, opts, chunk)
  const chunks = chunksFor(rows, opts.maxParams ?? MAX_PARAMS[db.dialect], statement)
  // Every row is inserted, updated or (with `update: false`) left as it is, so
  // each comes back — unless its target matched a row it may not see or touch
  // (another tenant's). Checked per chunk, so an atomic upsert of several
  // chunks rolls back.
  const written = (stored: Row[], expected: number) => {
    if (stored.length < expected) {
      throw new Error(
        `kickjs-db: upsert into ${table} wrote ${stored.length} of ${expected} rows — the rest matched rows it may not update, such as another tenant's`,
      )
    }
    return stored
  }
  // The rows by their target values — from the primary, which has them; a
  // replica may not yet.
  // A partial index's predicate too: a row outside it can share the target.
  const readBack = (chunk: Row[]): Promise<Row[]> => {
    let q = (db.primary.selectFrom as (t: string) => any)(table)
      .selectAll()
      .where((eb: ExpressionBuilder<any, any>) =>
        eb.or(chunk.map((r) => eb.and(opts.target.map((c: string) => eb(c, '=', key(r, c)))))),
      )
    if (opts.where) q = q.where(opts.where)
    return q.execute()
  }
  if (opts.update === false) {
    // Each row is read back by its target, so every row needs one — a key
    // the database generates can't be the target here.
    for (const row of rows) {
      const missing = opts.target.find((c) => key(row, c) === undefined || key(row, c) === null)
      if (missing) {
        throw new Error(
          `kickjs-db: upsert({ update: false }) reads each row back by its target, and a row has no ${missing}`,
        )
      }
    }
    if (db.dialect === 'mysql' && opts.where) {
      throw new Error(
        'kickjs-db: upsert({ where }) needs a partial unique index, which MySQL has no syntax for',
      )
    }
  }
  /** How many different targets a chunk names (a row may repeat one). */
  const distinctTargets = (chunk: Row[]) =>
    new Set(
      chunk.map((r) =>
        opts.target.map((c) => `${typeof key(r, c)}:${String(key(r, c))}`).join('\u0000'),
      ),
    ).size
  return inChunks(db, chunks, opts.atomic ?? true, async (chunk) => {
    if (opts.update === false) {
      const expected = distinctTargets(chunk)
      // DO NOTHING returns only what it inserted: read every row back.
      await statement(chunk).execute()
      return written(await readBack(chunk), expected)
    }
    if (db.dialect !== 'mysql') return written(await statement(chunk).execute(), chunk.length)
    await statement(chunk).execute()
    // No RETURNING on MySQL. (Its tenancy refuses ON DUPLICATE KEY, so the
    // count needs no check.)
    return readBack(chunk)
  }) as Promise<Selectable<DB[T]>[]>
}

/** One statement's worth of `upsert` — with RETURNING, except on MySQL. */
function upsertStatement<DB, T extends keyof DB & string>(
  db: KickDbClient<DB>,
  table: T,
  opts: UpsertOptions<DB, T>,
  rows: Row[],
): any {
  const target = [...opts.target] as string[]
  if (target.length === 0) throw new Error('kickjs-db: upsert() needs at least one target column')

  const insert = (db.insertInto as (t: string) => any)(table).values(rows)
  if (opts.update === false) {
    if (db.dialect === 'mysql') {
      // A no-op update, not INSERT IGNORE: that would also turn other errors
      // (a value too long, a bad date) into warnings.
      return insert.onDuplicateKeyUpdate({ [target[0]!]: sql.ref(target[0]!) })
    }
    return insert.onConflict((oc: any) => {
      let conflict = oc.columns(target)
      if (opts.where) conflict = conflict.where(opts.where)
      return conflict.doNothing()
    })
  }

  const update = opts.update ?? Object.keys(rows[0]!).filter((c) => !target.includes(c))
  const takeIncoming = Array.isArray(update)
  // Nothing to update still has to be an update, or the conflicting rows
  // wouldn't come back: set a target column to itself.
  const columns = takeIncoming
    ? (update as string[]).length > 0
      ? (update as string[])
      : [target[0]!]
    : []

  if (db.dialect === 'mysql') {
    if (opts.where) {
      throw new Error(
        'kickjs-db: upsert({ where }) needs a partial unique index, which MySQL has no syntax for',
      )
    }
    const set = takeIncoming
      ? Object.fromEntries(columns.map((c) => [c, sql`VALUES(${sql.ref(c)})`]))
      : update
    return insert.onDuplicateKeyUpdate(set)
  }

  return insert
    .onConflict((oc: any) => {
      let conflict = oc.columns(target)
      if (opts.where) conflict = conflict.where(opts.where)
      return conflict.doUpdateSet(
        takeIncoming
          ? (eb: ExpressionBuilder<any, any>) =>
              Object.fromEntries(columns.map((c) => [c, eb.ref(`excluded.${c}`)]))
          : update,
      )
    })
    .returningAll()
}

/**
 * The row matching `where`, or a new one built from `where` + `create`.
 * Race-safe: if another request inserts the same row first, the unique
 * violation is caught and that row is read instead — outside a transaction,
 * or inside a READ COMMITTED one. Inside a REPEATABLE READ or SERIALIZABLE
 * transaction (MySQL's default) the re-read sees the transaction's snapshot,
 * which can't include the winner's row, so the UniqueViolationError is
 * rethrown: retry the whole transaction.
 */
export async function findOrCreate<
  DB,
  T extends keyof DB & string,
  W extends Partial<Selectable<DB[T]>>,
>(
  db: KickDbClient<DB>,
  table: T,
  opts: FindOrCreateOptions<DB, T, W>,
): Promise<{ row: Selectable<DB[T]>; created: boolean }> {
  const where = Object.entries(opts.where as Row)
  if (where.length === 0) throw new Error('kickjs-db: findOrCreate() needs a where')

  const find = async (client: KickDbClient<DB>) =>
    (await (client.selectFrom as (t: string) => any)(table)
      .selectAll()
      .where((eb: ExpressionBuilder<any, any>) => eb.and(where.map(([c, v]) => eb(c, '=', v))))
      .executeTakeFirst()) as Selectable<DB[T]> | undefined

  // Read from the primary: after losing the race, the winner's row is there
  // — a lagging replica may not have it yet.
  const primary = db.primary
  const found = await find(primary)
  if (found) return { row: found, created: false }

  const values = { ...(opts.where as Row), ...(opts.create as Row) }
  const create = async (client: KickDbClient<DB>) => {
    const insert = (client.insertInto as (t: string) => any)(table).values(values)
    if (client.dialect === 'mysql') {
      await insert.execute()
      return (await find(client))!
    }
    return (await insert.returningAll().executeTakeFirstOrThrow()) as Selectable<DB[T]>
  }

  try {
    // Inside a transaction, a failed insert aborts it on Postgres — contain it in a savepoint.
    const row = db.inTransaction ? await db.savepoint(create) : await create(db)
    return { row, created: true }
  } catch (err) {
    if (!(err instanceof UniqueViolationError)) throw err
    // Someone else created it first.
    const raced = await find(primary)
    if (raced) return { row: raced, created: false }
    throw err
  }
}
