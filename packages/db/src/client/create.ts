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
import { casingPlugins, toDbName, type Casing } from '../snapshot/casing'
import { columnNamePlugins, type ColumnNameMap } from './column-names'
import { qualifiedTableName, unwrapTable } from '../dsl/table'
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
/** The DevTools event bus type, as the `bus` option declares it. */
type KickEventBus = NonNullable<CreateDbClientOptions<unknown, unknown>['bus']>

/** The DevTools adapter's process-wide bus slot (shared via `Symbol.for`; see devtools-kit). */
const ACTIVE_DEVTOOLS_BUS = Symbol.for('kickjs.devtools.bus')

export function createDbClient<TSchema, DB = SchemaToTypes<TSchema>>(
  opts: CreateDbClientOptions<TSchema, DB>,
): KickDbClient<DB> {
  // Local listeners (`db.on(...)`) need the emitter; `slowQueryThresholdMs`
  // and an explicit `bus` keep implying it, as before.
  const eventsEnabled = opts.events || opts.slowQueryThresholdMs != null || opts.bus != null
  const events = eventsEnabled ? new KickDbEventEmitter() : null
  const slowThreshold = opts.slowQueryThresholdMs ?? null
  const dialectTag = detectDialect(opts.dialect, opts.dialectTag)
  /**
   * Where DevTools events go: the `bus` passed in, else the DevTools bus while
   * the DevTools adapter runs. Looked up per query, so a client created at
   * import time — before DevTools starts — still reports to the panel.
   */
  const devtoolsBus = (): KickEventBus | undefined =>
    opts.bus ?? (globalThis as Record<symbol, KickEventBus | undefined>)[ACTIVE_DEVTOOLS_BUS]

  // Build customType codec maps once. Both transforms short-circuit
  // when their map is empty so the plugin is free of per-row /
  // per-query cost when no customType is in play. Plugin only
  // attached when at least one side has work to do.
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
    if (
      (opts.tenancy.strategy === 'rls' || opts.tenancy.strategy === 'schema') &&
      dialectTag !== 'postgres'
    ) {
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
  // `.colName()` columns: rewritten after casing on the way out, so a name like
  // `EMAIL` isn't converted again; renamed back before casing on the way in.
  const columnNames = collectColumnNames(opts.schema, opts.casing)
  if (columnNames.size > 0) {
    const named = columnNamePlugins(columnNames)
    plugins.unshift(named.first)
    plugins.push(named.last)
  }

  const makeKysely = (dialect: KyselyDialect) =>
    new Kysely<DB>({
      // Driver failures surface as typed errors (UniqueViolationError, …).
      dialect: translatingDialect(tenantConnections(dialect, opts.tenancy), dialectTag),
      plugins: plugins.length > 0 ? plugins : undefined,
      // Always installed: whether DevTools is listening is only known per query.
      log: (event) => {
        const bus = devtoolsBus()
        if (!events && !bus) return
        if (event.level === 'query') {
          const durationMs = event.queryDurationMillis
          const payload = { sql: event.query.sql, parameters: event.query.parameters, durationMs }
          const slow = slowThreshold != null && durationMs >= slowThreshold
          events?.emit('query', payload)
          if (slow) events?.emit('slowQuery', { ...payload, thresholdMs: slowThreshold })
          // Mirrored under `db:` so DevTools tabs know they came from kick/db.
          bus?.emit('db:query', { ...payload, dialect: dialectTag })
          if (slow) bus?.emit('db:slow-query', { ...payload, thresholdMs: slowThreshold })
        } else if (event.level === 'error') {
          const payload = {
            sql: event.query.sql,
            parameters: event.query.parameters,
            error: event.error,
          }
          events?.emit('queryError', payload)
          bus?.emit('db:query-error', payload)
        }
      },
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
    { keys: true }, // the compiler works in keys; the column-name plugin maps them
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
    route: opts.route,
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

/**
 * `.colName()` columns by table and column, as queries name them when this
 * plugin sees them — after `casing` has converted the rest.
 */
function collectColumnNames(schema: unknown, casing: Casing | undefined): ColumnNameMap {
  const out = new Map<string, Map<string, string>>()
  const name = casing === 'snake_case' ? toDbName : (n: string) => n
  for (const exported of Object.values((schema ?? {}) as Record<string, unknown>)) {
    const t = unwrapTable(exported)
    if (!t) continue
    for (const [key, builder] of Object.entries(t.__columns)) {
      const colName = (builder as { __state(): { colName?: string } }).__state().colName
      if (colName === undefined) continue
      const table = qualifiedTableName(t).split('.').map(name).join('.')
      if (!out.has(table)) out.set(table, new Map())
      out.get(table)!.set(name(key), colName)
    }
  }
  return out
}
