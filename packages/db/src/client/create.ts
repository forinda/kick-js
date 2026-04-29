import { Kysely, type Dialect as KyselyDialect } from 'kysely'

import type { CreateDbClientOptions, KickDbClient } from './types'
import type { SchemaToTypes } from './schema-types'
import { KickDbEventEmitter } from './events'
import { CodecPlugin, buildDecoderMap, buildEncoderMap } from './codec-plugin'
import { wrap, type InternalContext } from './wrap'

// DB defaults to SchemaToTypes<TSchema> so the returned client is typed
// directly from the schema parameter — no KickDbRegister lookup at the call
// site. This breaks the `dbClient → RegisteredDB → KickDbRegister['db'] →
// typeof dbClient` cycle that would otherwise resolve to `unknown`.
// KickDbRegister is only consulted when consumers reference `KickDbClient`
// with no explicit generic.
export function createDbClient<TSchema, DB = SchemaToTypes<TSchema>>(
  opts: CreateDbClientOptions<TSchema, DB>,
): KickDbClient<DB> {
  // `slowQueryThresholdMs` and `bus` both imply events — listeners can't
  // subscribe to slowQuery / queryError, and the bus republisher can't
  // observe them, without the emitter being live.
  const eventsEnabled = opts.events || opts.slowQueryThresholdMs != null || opts.bus != null
  const events = eventsEnabled ? new KickDbEventEmitter() : null
  const slowThreshold = opts.slowQueryThresholdMs ?? null
  const bus = opts.bus ?? null

  // Republish to the DevTools event bus when wired. Mirror the local
  // event names under a `db:` namespace so adopter tabs / cross-cutting
  // log consumers know they came from kickjs-db.
  if (events && bus) {
    events.on('slowQuery', (payload) => {
      bus.emit('db:slow-query', payload)
    })
    events.on('queryError', (payload) => {
      bus.emit('db:query-error', payload)
    })
  }

  // Kysely's `log` config fires on every query — both success
  // (level 'query') and failure (level 'error') — with the compiled
  // SQL, params, and timing. Cleanest hook for the lifecycle events;
  // a full KyselyPlugin (transformQuery / transformResult) is heavier
  // and only worth it when we need to mutate the SQL tree.
  // Build customType codec maps once. Both transforms short-circuit
  // when their map is empty so the plugin is free of per-row /
  // per-query cost when no customType is in play. Plugin only
  // attached when at least one side has work to do.
  const decoders = buildDecoderMap(opts.schema)
  const encoders = buildEncoderMap(opts.schema)
  const codecPlugin =
    decoders.size > 0 || encoders.size > 0 ? new CodecPlugin(encoders, decoders) : null

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
