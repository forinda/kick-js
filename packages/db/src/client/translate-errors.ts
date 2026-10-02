/**
 * Make every query a client runs report typed errors: wrap the dialect so
 * its driver's connections translate failures as they're thrown. Covers
 * queries, streams, transactions (Postgres can fail a serializable
 * transaction at COMMIT) and savepoints, and connecting itself.
 *
 * The wrapper patches methods on the driver's own objects rather than
 * proxying them: drivers keep state in private `#fields`, which a Proxy
 * can't reach.
 */
import type { CompiledQuery, DatabaseConnection, Dialect, Driver } from 'kysely'
import { encodeDateParameters } from './sqlite-dates'
import { translateDbError, type DbDialect } from '../db-errors'

const PATCHED = Symbol('kick.db.translatesErrors')

export function translatingDialect(dialect: Dialect, tag: DbDialect): Dialect {
  const translate = (err: unknown): never => {
    throw translateDbError(err, tag)
  }
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args)
      } catch (err) {
        return translate(err)
      }
    }

  const patchConnection = (conn: DatabaseConnection): DatabaseConnection => {
    const marked = conn as DatabaseConnection & { [PATCHED]?: true }
    if (marked[PATCHED]) return conn
    marked[PATCHED] = true
    const exec = conn.executeQuery.bind(conn)
    conn.executeQuery = guard((query: CompiledQuery, ...rest: unknown[]) =>
      (exec as (...a: unknown[]) => Promise<unknown>)(
        // better-sqlite3 binds no Date — store it the way SQLite's own timestamps look.
        tag === 'sqlite' ? { ...query, parameters: encodeDateParameters(query.parameters) } : query,
        ...rest,
      ),
    ) as DatabaseConnection['executeQuery']
    const stream = conn.streamQuery.bind(conn)
    conn.streamQuery = async function* (...args: Parameters<DatabaseConnection['streamQuery']>) {
      const [query, ...rest] = args
      const encoded =
        tag === 'sqlite' ? { ...query, parameters: encodeDateParameters(query.parameters) } : query
      try {
        yield* stream(encoded, ...rest)
      } catch (err) {
        translate(err)
      }
    }
    return conn
  }

  const patchDriver = (driver: Driver): Driver => {
    const acquire = driver.acquireConnection.bind(driver)
    driver.acquireConnection = guard(async () => patchConnection(await acquire()))
    for (const name of [
      'beginTransaction',
      'commitTransaction',
      'rollbackTransaction',
      'savepoint',
      'rollbackToSavepoint',
      'releaseSavepoint',
    ] as const) {
      const fn = driver[name] as ((...a: unknown[]) => Promise<void>) | undefined
      if (fn) (driver as unknown as Record<string, unknown>)[name] = guard(fn.bind(driver))
    }
    return driver
  }

  return {
    createAdapter: () => dialect.createAdapter(),
    createQueryCompiler: () => dialect.createQueryCompiler(),
    createIntrospector: (db) => dialect.createIntrospector(db),
    createDriver: () => patchDriver(dialect.createDriver()),
  }
}
