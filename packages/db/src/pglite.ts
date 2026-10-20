// `@forinda/kickjs-db/pglite` — PGlite (embedded Postgres) as a pg pool, for
// `pgDialect()` and `pgAdapter()`. `@electric-sql/pglite` isn't a dependency:
// pass your own instance.
import type { PgClientLike, PgPoolLike } from './adapters/pg/adapter'

/** PGlite's results already have pg's shape: `rows`, `rowCount`, `command`. */
type PgResult = { rows: any[]; rowCount?: number | null; command?: string }

/** The part of a `PGlite` instance the pool uses. */
export interface PGliteLike {
  query(sql: string, params?: any[]): Promise<PgResult>
  exec(sql: string): Promise<PgResult[]>
  close(): Promise<void>
}

/**
 * A pool over one PGlite database. PGlite is a single connection, so the pool
 * hands it to one caller at a time: `connect()` waits until the previous
 * client is released, and `pool.query()` waits too — otherwise a request's
 * statements would run inside another request's open transaction. Share one
 * pool between the client and the migration adapter:
 *
 * ```ts
 * import { PGlite } from '@electric-sql/pglite'
 * import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
 * import { pglitePool } from '@forinda/kickjs-db/pglite'
 *
 * const pool = pglitePool(new PGlite('./data/pg'))
 * export const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
 * export const migrationAdapter = pgAdapter({ pool })
 * ```
 *
 * `end()` closes the database. `.stream()` isn't supported: it needs `pg-cursor`.
 */
export function pglitePool(db: PGliteLike): PgPoolLike {
  // ponytail: one holder at a time — PGlite serialises queries anyway.
  let tail: Promise<void> = Promise.resolve()
  const turn = () => {
    let release!: () => void
    const mine = new Promise<void>((resolve) => (release = resolve))
    const ready = tail
    tail = tail.then(() => mine)
    return ready.then(() => release)
  }

  // Without parameters SQL may hold several statements (a migration's up.sql),
  // which only exec() runs; the result is the last statement's.
  async function run(sql: string, params?: readonly unknown[]): Promise<PgResult> {
    if (params && params.length > 0) return db.query(sql, [...params])
    return (await db.exec(sql)).at(-1) ?? { rows: [], rowCount: 0 }
  }

  return {
    async query(sql, params) {
      const release = await turn()
      try {
        return (await run(sql, params)) as never
      } finally {
        release()
      }
    },
    async connect(): Promise<PgClientLike> {
      const release = await turn()
      let released = false
      return {
        query: (sql, params) => run(sql, params) as never,
        release() {
          if (released) return
          released = true
          release()
        },
      }
    },
    async end() {
      await db.close()
    },
  }
}
