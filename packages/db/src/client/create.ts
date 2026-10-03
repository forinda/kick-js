import { AsyncLocalStorage } from 'node:async_hooks'
import {
  Kysely,
  ParseJSONResultsPlugin,
  type Dialect as KyselyDialect,
  type KyselyPlugin,
} from 'kysely'

import type { CreateDbClientOptions, KickDbClient } from './types'
import type { SchemaToTypes } from './schema-types'
import { KickDbEventEmitter } from './events'
import {
  CodecPlugin,
  buildComparisonEncoderMap,
  buildDecoderMap,
  buildEncoderMap,
  buildNestedDecoderMap,
  collectRelationKeys,
} from './codec-plugin'
import { wrap, type InternalContext } from './wrap'
import { tenancyPlugin } from './tenancy-plugin'
import { tenantConnections } from './tenancy-connections'
import { translatingDialect } from './translate-errors'
import { extractRelations } from '../query/extract-relations'
import { casingPlugins } from '../snapshot/casing'
import { ManagedColumnsPlugin, collectManaged } from './managed'
import type { CompileTable } from '../query/compile-shared'
import {
  KICK_DIALECT_DATES,
  isDialectTag,
  readDialectMark,
  type DialectDateOptions,
  type DialectTag,
} from '../dialect-marker'
import { pickCompiler } from '../query/compilers'
import { extractSnapshot } from '../snapshot/extract'

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
  const dialectTag = detectDialect(opts.dialect, opts.dialectTag)
  const decoders = buildDecoderMap(opts.schema, dialectTag)
  const encoders = buildEncoderMap(opts.schema, dialectTag)
  const dates = (opts.dialect as { [KICK_DIALECT_DATES]?: DialectDateOptions } | undefined)?.[
    KICK_DIALECT_DATES
  ]
  const nestedDecoders = buildNestedDecoderMap(opts.schema, dialectTag, dates)
  const codecPlugin =
    decoders.size > 0 || encoders.size > 0 || nestedDecoders.size > 0
      ? new CodecPlugin(
          encoders,
          decoders,
          collectRelationKeys(opts.schema),
          buildComparisonEncoderMap(opts.schema, dialectTag),
          nestedDecoders,
        )
      : null

  // Detect dialect early — needed both to pick the relational query
  // compiler (below) and to decide whether the JSON-results plugin
  // ships in the Kysely plugin chain.
  //
  // SQLite + MySQL drivers return JSON columns as TEXT, so the
  // kysely/helpers/<dialect> jsonArrayFrom / jsonObjectFrom won't
  // round-trip without ParseJSONResultsPlugin. PG decodes JSON
  // natively — skip the plugin there to keep the chain minimal.

  // Unified per-query stream for the DevTools "Database" tab — every
  // successful query republished as `db:query` with the dialect tag so
  // the tab can render duration / SQL / dialect. Failures keep flowing on
  // `db:query-error` (wired above); the tab subscribes to both. Tagging
  // here (rather than the block above) keeps `dialectTag` in scope.
  if (events && bus) {
    events.on('query', (payload) => {
      bus.emit('db:query', { ...payload, dialect: dialectTag })
    })
  }

  const managed = collectManaged(opts.schema)
  const plugins: KyselyPlugin[] = []
  // Before the codec plugin, so a managed value it adds gets encoded too.
  if (managed.size > 0) plugins.push(new ManagedColumnsPlugin(managed))
  if (codecPlugin) plugins.push(codecPlugin)
  if (dialectTag === 'sqlite' || dialectTag === 'mysql') {
    plugins.push(new ParseJSONResultsPlugin())
  }
  // M5.B.2 — adopter-supplied plugins (e.g. `safeNullComparison()`)
  // append after the built-ins so the AST transforms run on a tree
  // that already has the kickjs-internal codec / JSON rewriting in
  // place. Order matches Kysely's documented "plugins run top-down".
  if (opts.plugins && opts.plugins.length > 0) {
    plugins.push(...opts.plugins)
  }
  if (opts.tenancy) {
    if (opts.tenancy.strategy !== 'column' && dialectTag !== 'postgres') {
      throw new Error(`kickjs-db: '${opts.tenancy.strategy}' tenancy is Postgres-only`)
    }
    // Before the casing plugin's query half: it names the tenant column by key.
    const plugin = tenancyPlugin(opts.tenancy, opts.schema)
    if (plugin) plugins.push(plugin)
  }
  if (opts.casing === 'snake_case') {
    // Results are converted before anything reads them by key; queries after
    // everything else has written them by key.
    const casing = casingPlugins(collectRelationKeys(opts.schema))
    plugins.unshift(casing.first)
    plugins.push(casing.last)
  }

  const makeKysely = (dialect: KyselyDialect) =>
    new Kysely<DB>({
      // Driver failures surface as typed errors (UniqueViolationError, …).
      dialect: translatingDialect(tenantConnections(dialect, opts.tenancy), dialectTag),
      plugins: plugins.length > 0 ? plugins : undefined,
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
  const kysely = makeKysely(opts.dialect)
  const replicas = (opts.replica === undefined ? [] : [opts.replica].flat()).map(makeKysely)

  // Resolve `relations()` declarations into the JSON-serializable
  // sidecar consumed by the query compiler. Schemas without any
  // `relations()` get an empty record — the compiler still works
  // (errors clearly on `with` keys when nothing is declared).
  const tables: Record<string, CompileTable> = extractSnapshot(
    opts.schema as Record<string, unknown>,
    dialectTag,
  ).tables
  // The compiler skips soft-deleted rows; tell it which column marks them.
  for (const [name, m] of managed) {
    if (m.softDelete && tables[name]) tables[name] = { ...tables[name], softDelete: m.softDelete }
  }
  const relations = extractRelations(opts.schema as Record<string, unknown>, tables) ?? {}

  const ctx: InternalContext = {
    events,
    dialect: dialectTag,
    savepointCounter: { value: 0 },
    root: kysely,
    replicas,
    nextReplica: 0,
    transactions: new AsyncLocalStorage(),
    query: {
      relations,
      tables,
      compile: pickCompiler(dialectTag),
    },
  }
  return wrap<DB>(kysely, ctx, { root: true })
}

function detectDialect(dialect: KyselyDialect, override?: DialectTag): KickDbClient['dialect'] {
  if (override) {
    if (!isDialectTag(override)) {
      throw new Error(
        `createDbClient: dialectTag must be 'postgres', 'mysql' or 'sqlite', got ${String(override)}`,
      )
    }
    return override
  }
  // Fast path: KickJS's own dialect factories (`pgDialect` /
  // `mysqlDialect` / `sqliteDialect`) stamp an explicit marker, so
  // detection is exact and never silently mis-classifies.
  const marked = readDialectMark(dialect)
  if (marked) return marked

  // Raw Kysely dialects (Neon, D1, libsql, bun:sqlite, PlanetScale, …):
  // their adapter is Kysely's PostgresAdapter / MysqlAdapter /
  // SqliteAdapter, so the dialect or adapter class name tells which SQL
  // to compile.
  const dialectCtor = (dialect.constructor as { name?: string })?.name ?? ''
  const adapterCtor = (dialect.createAdapter().constructor as { name?: string })?.name ?? ''
  const tag = `${dialectCtor} ${adapterCtor}`
  if (/Postgres/i.test(tag)) return 'postgres'
  if (/Mysql/i.test(tag)) return 'mysql'
  if (/Sqlite/i.test(tag)) return 'sqlite'
  // Guessing would compile the wrong SQL (JSON aggregation, quoting) and
  // fail at the first query, far from the cause.
  throw new Error(
    `createDbClient: can't tell which SQL dialect ${dialectCtor || 'this dialect'} speaks. ` +
      `Pass dialectTag: 'postgres' | 'mysql' | 'sqlite'.`,
  )
}
