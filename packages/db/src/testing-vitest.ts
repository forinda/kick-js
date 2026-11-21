/**
 * `@forinda/kickjs-db/testing/vitest` — a test database in one line per file:
 * made before the file's tests, dropped after.
 *
 *   const t = useTestDb({ migrationsDir: 'db/migrations' })
 *   it('lists users', async () => { await t.db.selectFrom('users')… })
 *
 * On a shared server (`kickTestServices` from `@forinda/kickjs-testing/vitest`)
 * each file gets its own database; with no server, an in-memory SQLite one.
 *
 * @module @forinda/kickjs-db/testing/vitest
 */
import { afterAll, beforeAll, inject } from 'vitest'
import type { KickDbClient } from './client/types'
import type { SchemaToTypes } from './client/schema-types'
import {
  createMysqlTestDb,
  createPgTestDb,
  createTestDb,
  type ServerTestDbOptions,
} from './testing'
import { testDbDialect } from './test-db-dialect'

export interface UseTestDbOptions<S> extends ServerTestDbOptions<S> {
  /**
   * Default: `'postgres'` when a Postgres server is known (`connectionString`,
   * `inject('postgres')` or `KICK_TEST_POSTGRES_URL`), else `'mysql'` when a
   * MySQL one is (`inject('mysql')` / `KICK_TEST_MYSQL_URL`), else `'sqlite'` —
   * but with a `migrationsDir` and no server it throws: set `'sqlite'` for SQLite migrations.
   */
  dialect?: 'postgres' | 'mysql' | 'sqlite'
}

export interface TestDbHandle<S> {
  /** The client — inside tests (it's made in `beforeAll`). */
  readonly db: KickDbClient<SchemaToTypes<S>>
  /** The database's connection string; `undefined` for SQLite. */
  readonly connectionString?: string
}

/** A value `kickTestServices` provided, if it ran. */
const provided = (key: string): string | undefined => {
  try {
    return (inject as unknown as (k: string) => string | undefined)(key)
  } catch {
    return undefined
  }
}

/**
 * A database for this test file: created in `beforeAll`, dropped in
 * `afterAll`, reached through the returned handle's `db`.
 */
export function useTestDb<S>(opts: UseTestDbOptions<S>): TestDbHandle<S> {
  let db: KickDbClient<SchemaToTypes<S>> | undefined
  let connectionString: string | undefined
  let drop: (() => Promise<void>) | undefined

  beforeAll(async () => {
    const pgUrl = provided('postgres') ?? process.env.KICK_TEST_POSTGRES_URL
    const mysqlUrl = provided('mysql') ?? process.env.KICK_TEST_MYSQL_URL
    const dialect = testDbDialect(opts, { pg: pgUrl, mysql: mysqlUrl })
    if (dialect === 'sqlite') {
      db = await createTestDb({ ...opts, schema: opts.schema ?? ({} as S) })
      drop = () => db!.destroy()
      return
    }
    const made =
      dialect === 'postgres'
        ? await createPgTestDb({ ...opts, connectionString: opts.connectionString ?? pgUrl })
        : await createMysqlTestDb({ ...opts, connectionString: opts.connectionString ?? mysqlUrl })
    ;({ db, connectionString } = made)
    drop = made.drop
  })
  afterAll(async () => {
    await drop?.()
  })

  return {
    get db() {
      if (!db) {
        throw new Error(
          'useTestDb: the database exists inside tests (beforeAll has not run) — read `.db` in a test or a hook',
        )
      }
      return db
    },
    get connectionString() {
      return connectionString
    },
  }
}
