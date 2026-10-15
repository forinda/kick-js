/**
 * `db.insertMany()` — insert any number of rows, in as few statements as the
 * dialect's limit on bind parameters allows.
 *
 * One `insertInto(t).values(rows)` is one statement with a parameter per
 * value, and every database caps those: 65,535 on Postgres and MySQL, 32,766
 * on SQLite (100 on Cloudflare D1). Past the cap the statement fails. This
 * splits the rows into statements that fit, in one transaction.
 */
import type { Insertable, Selectable } from 'kysely'
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

/**
 * `rows` in groups that each fit in one statement: `maxParams` divided by the
 * columns any row has (a row missing a column still takes its slot).
 */
export function chunksFor(rows: readonly Row[], maxParams: number, extraPerRow = 0): Row[][] {
  if (!Number.isInteger(maxParams) || maxParams < 1) {
    throw new Error('kickjs-db: maxParams must be a whole number, at least 1')
  }
  const columns = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row)) columns.add(key)
  const perRow = Math.max(1, columns.size + extraPerRow)
  const size = Math.floor(maxParams / perRow)
  if (size < 1) {
    throw new Error(
      `kickjs-db: one row needs ${perRow} parameters, more than maxParams (${maxParams})`,
    )
  }
  const chunks: Row[][] = []
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size) as Row[])
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
  options: InsertManyOptions & { returning?: boolean } = {},
): Promise<number | Selectable<DB[T]>[]> {
  if (options.returning && db.dialect === 'mysql') {
    throw new Error(
      'kickjs-db: insertMany({ returning }) needs RETURNING, which MySQL has no syntax for',
    )
  }
  const chunks = chunksFor(rows as Row[], options.maxParams ?? MAX_PARAMS[db.dialect])
  const insert = (chunk: Row[]) => (db.insertInto as (t: string) => any)(table).values(chunk)
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
