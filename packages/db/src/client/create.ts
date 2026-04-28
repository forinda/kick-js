import { Kysely, sql, type Dialect as KyselyDialect } from 'kysely'

import type { CreateDbClientOptions, KickDbClient, TransactionEvent } from './types'
import type { SchemaToKysely } from './schema-types'
import { KickDbEventEmitter } from './events'
import { CodecResultPlugin, buildDecoderMap } from './codec-plugin'
import { applyExtensions } from '../extend/apply'

interface InternalContext {
  events: KickDbEventEmitter | null
  dialect: KickDbClient['dialect']
  /** Increments per savepoint open inside this client; used for SP_<n> names. */
  savepointCounter: { value: number }
}

// DB defaults to SchemaToKysely<TSchema> so the returned client is typed
// directly from the schema parameter — no KickDbRegister lookup at the call
// site. This breaks the `dbClient → RegisteredDB → KickDbRegister['db'] →
// typeof dbClient` cycle that would otherwise resolve to `unknown`.
// KickDbRegister is only consulted when consumers reference `KickDbClient`
// with no explicit generic.
export function createDbClient<TSchema, DB = SchemaToKysely<TSchema>>(
  opts: CreateDbClientOptions<TSchema, DB>,
): KickDbClient<DB> {
  // `slowQueryThresholdMs` implies events — listeners can't subscribe to
  // slowQuery without the emitter being live.
  const eventsEnabled = opts.events || opts.slowQueryThresholdMs != null
  const events = eventsEnabled ? new KickDbEventEmitter() : null
  const slowThreshold = opts.slowQueryThresholdMs ?? null

  // Kysely's `log` config fires on every query — both success
  // (level 'query') and failure (level 'error') — with the compiled
  // SQL, params, and timing. Cleanest hook for the lifecycle events;
  // a full KyselyPlugin (transformQuery / transformResult) is heavier
  // and only worth it when we need to mutate the SQL tree.
  // Build the customType decoder map once. When no column declared
  // a `fromDriver` codec, the decoder map is empty and the plugin's
  // transformResult short-circuits — zero per-row cost on the hot
  // path. Encoders (toDriver) are NOT consumed yet — that requires
  // walking the InsertQueryNode / UpdateQueryNode trees, lands in a
  // follow-up.
  const decoders = buildDecoderMap(opts.schema)
  const codecPlugin = decoders.size > 0 ? new CodecResultPlugin(decoders) : null

  const kysely = new Kysely<DB>({
    dialect: opts.dialect,
    plugins: codecPlugin ? [codecPlugin] : undefined,
    log: events
      ? (event) => {
          if (event.level === 'query') {
            const durationMs = event.queryDurationMillis
            const payload = {
              sql: event.query.sql,
              parameters: event.query.parameters,
              durationMs,
            }
            events.emit('query', payload)
            if (slowThreshold != null && durationMs >= slowThreshold) {
              events.emit('slowQuery', { ...payload, thresholdMs: slowThreshold })
            }
          } else if (event.level === 'error') {
            events.emit('queryError', {
              sql: event.query.sql,
              parameters: event.query.parameters,
              error: event.error,
            })
          }
        }
      : undefined,
  })

  const ctx: InternalContext = {
    events,
    dialect: detectDialect(opts.dialect),
    savepointCounter: { value: 0 },
  }
  return wrap<DB>(kysely, ctx)
}

function detectDialect(dialect: KyselyDialect): KickDbClient['dialect'] {
  // Kysely's dialects have ctor names like PostgresDialect / SqliteDialect / MysqlDialect.
  const name = (dialect.constructor as { name?: string })?.name ?? ''
  if (name.includes('Postgres')) return 'postgres'
  if (name.includes('Mysql') || name.includes('MySql')) return 'mysql'
  return 'sqlite'
}

function wrap<DB>(kysely: Kysely<DB>, ctx: InternalContext): KickDbClient<DB> {
  const client: KickDbClient<DB> = {
    kysely,
    dialect: ctx.dialect,

    selectFrom: kysely.selectFrom.bind(kysely),
    insertInto: kysely.insertInto.bind(kysely),
    updateTable: kysely.updateTable.bind(kysely),
    deleteFrom: kysely.deleteFrom.bind(kysely),

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
          const result = await kysely.transaction().execute(async (tx) => {
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
      return applyExtensions(client, ext)
    },

    async savepoint(fn) {
      const name = `sp_${++ctx.savepointCounter.value}`
      // Savepoints only make sense inside a transaction. Kysely's transaction
      // proxies route SQL through the same connection; sql.raw() against the
      // wrapper lands on that connection's tx context.
      await sql.raw(`SAVEPOINT ${name}`).execute(kysely)
      try {
        const result = await fn(wrap<DB>(kysely, ctx))
        await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(kysely)
        return result
      } catch (err) {
        await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(kysely)
        throw err
      }
    },

    async destroy() {
      await kysely.destroy()
    },
  }
  return client
}
