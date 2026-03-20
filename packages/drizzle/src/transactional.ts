import { Container } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from './types'

/**
 * Execute a callback within a Drizzle transaction.
 * Resolves the db instance from the DI container and wraps the callback
 * in `db.transaction()`.
 *
 * @example
 * ```ts
 * import { transactional } from '@forinda/kickjs-drizzle'
 *
 * // In a service or controller:
 * const result = await transactional(async (tx) => {
 *   const user = tx.insert(users).values({ name: 'Alice', email: 'alice@example.com' }).returning().get()
 *   tx.insert(posts).values({ title: 'Hello', content: '...', authorId: user.id }).run()
 *   return user
 * })
 * ```
 */
export function transactional<T>(callback: (tx: any) => T | Promise<T>): T | Promise<T> {
  const db = Container.getInstance().resolve<any>(DRIZZLE_DB)
  return db.transaction(callback)
}
