/**
 * `db.insertMany()` — insert any number of rows, in as few statements as the
 * dialect's limit on bind parameters allows.
 *
 * One `insertInto(t).values(rows)` is one statement with a parameter per
 * value, and every database caps those: 65,535 on Postgres and MySQL, 32,766
 * on SQLite (100 on Cloudflare D1). Past the cap the statement fails. This
 * splits the rows into statements that fit, in one transaction.
 */
import type { ExpressionBuilder, Insertable, Selectable } from 'kysely'
import type { KickDbClient } from './types'

type Row = Record<string, unknown>

/** Bind parameters per statement, by dialect. */
export const MAX_PARAMS = { postgres: 65_535, mysql: 65_535, sqlite: 32_766 } as const

export interface InsertManyOptions {
  /**
   * Bind parameters one statement may use. Default the dialect's limit; set it
   * for a driver with a lower one — `100` for Cloudflare D1.
   */
  maxParams?: number
  /**
   * Run every statement in one transaction (joining the caller's if one is
   * open), so the rows land all together or not at all. Default `true`.
   * `false` for a driver without transactions (Cloudflare D1).
   */
  atomic?: boolean
}

/** A statement, before it runs. */
interface Compilable {
  compile(): { parameters: readonly unknown[] }
}

/**
 * `rows` in groups whose statement — what `build` makes of them — binds at
 * most `maxParams` parameters. Counted on the compiled SQL, so expression
 * values and an upsert's update set count too. The first guess is one
 * parameter per column any row has; a group over the limit shrinks in
 * proportion and is built again.
 */
export function chunksFor(
  rows: readonly Row[],
  maxParams: number,
  build: (rows: Row[]) => Compilable,
): Row[][] {
  if (!Number.isInteger(maxParams) || maxParams < 1) {
    throw new Error('kickjs-db: maxParams must be a whole number, at least 1')
  }
  const columns = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row)) columns.add(key)
  let size = Math.max(1, Math.floor(maxParams / Math.max(1, columns.size)))
  const chunks: Row[][] = []
  for (let i = 0; i < rows.length;) {
    const chunk = rows.slice(i, i + size) as Row[]
    const params = build(chunk).compile().parameters.length
    if (params > maxParams) {
      if (chunk.length === 1) {
        throw new Error(
          `kickjs-db: one row needs ${params} parameters, more than maxParams (${maxParams})`,
        )
      }
      size = Math.max(
        1,
        Math.min(chunk.length - 1, Math.floor((chunk.length * maxParams) / params)),
      )
      continue
    }
    chunks.push(chunk)
    i += chunk.length
  }
  return chunks
}

/** Run `work` once per chunk — in one transaction when there's more than one and `atomic`. */
export async function inChunks<T>(
  db: KickDbClient<any>,
  chunks: Row[][],
  atomic: boolean,
  work: (chunk: Row[]) => Promise<T[]>,
): Promise<T[]> {
  const run = async () => {
    const out: T[] = []
    for (const chunk of chunks) out.push(...(await work(chunk)))
    return out
  }
  // One statement is atomic already; more need a transaction to stay so.
  return chunks.length > 1 && atomic ? db.transaction(run) : run()
}

export async function insertMany<DB, T extends keyof DB & string>(
  db: KickDbClient<DB>,
  table: T,
  rows: ReadonlyArray<Insertable<DB[T]>>,
  options: InsertManyOptions & { returning?: boolean; readBack?: readonly string[] } = {},
): Promise<number | Selectable<DB[T]>[]> {
  const insert = (chunk: Row[]) => (db.insertInto as (t: string) => any)(table).values(chunk)
  const chunks = chunksFor(rows as Row[], options.maxParams ?? MAX_PARAMS[db.dialect], insert)
  if (options.returning && db.dialect === 'mysql') {
    return readBackOnMysql(db, table, rows as Row[], chunks, insert, options) as Promise<
      Selectable<DB[T]>[]
    >
  }
  if (options.returning) {
    return inChunks(db, chunks, options.atomic ?? true, (chunk) =>
      insert(chunk).returningAll().execute(),
    ) as Promise<Selectable<DB[T]>[]>
  }
  const counts = await inChunks(db, chunks, options.atomic ?? true, async (chunk) => {
    const results = (await insert(chunk).execute()) as { numInsertedOrUpdatedRows?: bigint }[]
    return [results.reduce((sum, r) => sum + Number(r.numInsertedOrUpdatedRows ?? 0n), 0)]
  })
  return counts.reduce((sum, n) => sum + n, 0)
}

/**
 * `returning` on MySQL, which has no RETURNING: insert, then read the rows back
 * by `readBack` — a unique key every row gives (its auto-increment ids can't be
 * relied on with other inserts running). In a transaction, so a key that turns
 * out not to be unique rolls the insert back. Rows come back in input order.
 */
async function readBackOnMysql<DB>(
  db: KickDbClient<DB>,
  table: string,
  rows: Row[],
  chunks: Row[][],
  insert: (chunk: Row[]) => any,
  options: InsertManyOptions & { readBack?: readonly string[] },
): Promise<Row[]> {
  const key = options.readBack ?? []
  if (key.length === 0) {
    throw new Error(
      'kickjs-db: insertMany({ returning }) on MySQL needs readBack — MySQL has no RETURNING, so ' +
        'the rows are read back by a unique key every row gives: ' +
        `insertMany('${table}', rows, { returning: true, readBack: ['email'] }). ` +
        'Leave out returning to get the count instead.',
    )
  }
  for (const row of rows) {
    const missing = key.find((c) => row[c] === undefined || row[c] === null)
    if (missing) {
      throw new Error(
        `kickjs-db: insertMany({ readBack }) reads each row back by [${key.join(', ')}], and a row has no ${missing}`,
      )
    }
  }
  // By text: an input '5' for an INT key comes back as the number 5.
  const idOf = (row: Row) => key.map((c) => String(row[c])).join('\u0000')
  const run = async () => {
    const out: Row[] = []
    for (const chunk of chunks) {
      await insert(chunk).execute()
      // From the primary, which has them; a replica may not yet.
      const stored = (await (db.primary.selectFrom as (t: string) => any)(table)
        .selectAll()
        .where((eb: ExpressionBuilder<any, any>) =>
          eb.or(chunk.map((r) => eb.and(key.map((c) => eb(c, '=', r[c]))))),
        )
        .execute()) as Row[]
      if (stored.length !== chunk.length) {
        throw new Error(
          `kickjs-db: insertMany read back ${stored.length} rows by [${key.join(', ')}] for the ${chunk.length} it inserted — readBack has to be a unique key`,
        )
      }
      const byId = new Map(stored.map((r) => [idOf(r), r]))
      for (const r of chunk) {
        const row = byId.get(idOf(r))
        // Never the input in its place: the caller asked for the rows as stored.
        if (!row) {
          throw new Error(
            `kickjs-db: insertMany couldn't match an inserted row back by [${key.join(', ')}] (${idOf(r)}) — the database stored the key differently (padding, a decimal's scale); read it back yourself`,
          )
        }
        out.push(row)
      }
    }
    return out
  }
  return (options.atomic ?? true) ? db.transaction(run) : run()
}
