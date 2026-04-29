// Wraps a Kysely<DB> + InternalContext into a KickDbClient<DB>.
//
// Lives in its own module so consumers that need to rebuild the
// client around a new Kysely instance — `$extends({ result })` adds a
// result-extension Kysely plugin via `qb.withPlugin(...)`, then wraps
// the new instance back into a client — can do so without an import
// cycle through `client/create.ts`. Both `create.ts` and
// `extend/apply.ts` import from here.
//
// `InternalContext` carries everything the wrap needs that lives
// outside the Kysely instance itself: the lifecycle event emitter,
// the cached dialect tag, and the savepoint counter. Sharing the same
// ctx across re-wraps keeps the event listener identity stable —
// adopters who attached `db.on('slowQuery', ...)` continue receiving
// events from the rebuilt-after-`$extends` client.

import { Kysely, sql } from 'kysely'

import type { KickDbClient, TransactionEvent } from './types'
import { applyExtensions } from '../extend/apply'
import type { KickDbEventEmitter } from './events'

export interface InternalContext {
  events: KickDbEventEmitter | null
  dialect: KickDbClient['dialect']
  /** Increments per savepoint open inside this client; used for SP_<n> names. */
  savepointCounter: { value: number }
}

export function wrap<DB>(qb: Kysely<DB>, ctx: InternalContext): KickDbClient<DB> {
  const client: KickDbClient<DB> = {
    qb,
    dialect: ctx.dialect,

    selectFrom: qb.selectFrom.bind(qb),
    insertInto: qb.insertInto.bind(qb),
    updateTable: qb.updateTable.bind(qb),
    deleteFrom: qb.deleteFrom.bind(qb),

    on(event, listener) {
      ctx.events?.on(event, listener)
      return client
    },
    off(event, listener) {
      ctx.events?.off(event, listener)
      return client
    },

    transaction: ((
      a: TransactionEvent | ((tx: KickDbClient<DB>) => Promise<unknown>),
      b?: (tx: KickDbClient<DB>) => Promise<unknown>,
    ) => {
      const txOpts = typeof a === 'function' ? {} : a
      const fn = (typeof a === 'function' ? a : b) as (tx: KickDbClient<DB>) => Promise<unknown>

      const run = async () => {
        ctx.events?.emit('transactionStart', { isolation: txOpts.isolation })
        try {
          const result = await qb.transaction().execute(async (tx) => {
            if (txOpts.isolation) {
              const level = txOpts.isolation.toUpperCase()
              await sql.raw(`SET TRANSACTION ISOLATION LEVEL ${level}`).execute(tx)
            }
            const child = wrap<DB>(tx as unknown as Kysely<DB>, ctx)
            return await fn(child)
          })
          ctx.events?.emit('transactionCommit', { isolation: txOpts.isolation })
          return result
        } catch (err) {
          ctx.events?.emit('transactionRollback', {
            isolation: txOpts.isolation,
            error: err,
          })
          throw err
        }
      }
      return run()
    }) as KickDbClient<DB>['transaction'],

    $extends(ext) {
      return applyExtensions(client, ctx, ext)
    },

    async savepoint(fn) {
      const name = `sp_${++ctx.savepointCounter.value}`
      // Savepoints only make sense inside a transaction. The query
      // builder's transaction proxies route SQL through the same
      // connection; sql.raw() against the wrapper lands on that
      // connection's tx context.
      await sql.raw(`SAVEPOINT ${name}`).execute(qb)
      try {
        const result = await fn(wrap<DB>(qb, ctx))
        await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(qb)
        return result
      } catch (err) {
        await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(qb)
        throw err
      }
    },

    async destroy() {
      await qb.destroy()
    },
  }
  return client
}
