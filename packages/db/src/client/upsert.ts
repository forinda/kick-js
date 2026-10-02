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
import type { KickDbClient } from './types'

type Row = Record<string, unknown>

export interface UpsertOptions<DB, T extends keyof DB & string> {
  /** The row — or rows — to insert. */
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
   */
  update?: ReadonlyArray<keyof DB[T] & string> | UpdateObject<DB, T>
  /**
   * The predicate of a partial unique index `target` refers to (Postgres,
   * SQLite). Write it as the index does, with literals — ``() => sql`active = 1` ``:
   * the database matches it against the index, and a bound parameter can't be.
   */
  where?: (eb: ExpressionBuilder<DB, T>) => Expression<SqlBool>
}

export interface FindOrCreateOptions<DB, T extends keyof DB & string> {
  /** Identifies the row — columns of a unique key. Also part of what's created. */
  where: Partial<Selectable<DB[T]>>
  /** The rest of the row to create when none matches `where`. */
  create?: Partial<Insertable<DB[T]>>
}

/** Insert `values`, or update the rows whose `target` already exists. Returns the rows as stored. */
export async function upsert<DB, T extends keyof DB & string>(
  db: KickDbClient<DB>,
  table: T,
  opts: UpsertOptions<DB, T>,
): Promise<Selectable<DB[T]>[]> {
  const rows = (Array.isArray(opts.values) ? opts.values : [opts.values]) as Row[]
  if (rows.length === 0) return []
  const target = [...opts.target] as string[]
  if (target.length === 0) throw new Error('kickjs-db: upsert() needs at least one target column')

  const update = opts.update ?? Object.keys(rows[0]!).filter((c) => !target.includes(c))
  const takeIncoming = Array.isArray(update)
  // Nothing to update still has to be an update, or the conflicting rows
  // wouldn't come back: set a target column to itself.
  const columns = takeIncoming
    ? (update as string[]).length > 0
      ? (update as string[])
      : [target[0]!]
    : []

  const insert = (db.insertInto as (t: string) => any)(table).values(rows)

  if (db.dialect === 'mysql') {
    if (opts.where) {
      throw new Error(
        'kickjs-db: upsert({ where }) needs a partial unique index, which MySQL has no syntax for',
      )
    }
    const set = takeIncoming
      ? Object.fromEntries(columns.map((c) => [c, sql`VALUES(${sql.ref(c)})`]))
      : update
    await insert.onDuplicateKeyUpdate(set).execute()
    // No RETURNING on MySQL: read the rows back by their target values.
    return (await (db.selectFrom as (t: string) => any)(table)
      .selectAll()
      .where((eb: ExpressionBuilder<any, any>) =>
        eb.or(rows.map((r) => eb.and(target.map((c) => eb(c, '=', r[c]))))),
      )
      .execute()) as Selectable<DB[T]>[]
  }

  return (await insert
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
    .execute()) as Selectable<DB[T]>[]
}

/**
 * The row matching `where`, or a new one built from `where` + `create`.
 * Race-safe: if another request inserts the same row first, the unique
 * violation is caught and that row is read instead.
 */
export async function findOrCreate<DB, T extends keyof DB & string>(
  db: KickDbClient<DB>,
  table: T,
  opts: FindOrCreateOptions<DB, T>,
): Promise<{ row: Selectable<DB[T]>; created: boolean }> {
  const where = Object.entries(opts.where as Row)
  if (where.length === 0) throw new Error('kickjs-db: findOrCreate() needs a where')

  const find = async (client: KickDbClient<DB>) =>
    (await (client.selectFrom as (t: string) => any)(table)
      .selectAll()
      .where((eb: ExpressionBuilder<any, any>) => eb.and(where.map(([c, v]) => eb(c, '=', v))))
      .executeTakeFirst()) as Selectable<DB[T]> | undefined

  const found = await find(db)
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
    const raced = await find(db)
    if (raced) return { row: raced, created: false }
    throw err
  }
}
