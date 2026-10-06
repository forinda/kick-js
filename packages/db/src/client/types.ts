import type {
  CommonTableExpression,
  Insertable,
  Kysely,
  Dialect as KyselyDialect,
  KyselyPlugin,
  Selectable,
} from 'kysely'

import type { RegisteredDB } from './register'
import type { QueryNamespace } from '../query/types'

export interface QueryEvent {
  sql: string
  parameters: readonly unknown[]
  durationMs: number
}

export interface QueryErrorEvent {
  sql: string
  parameters: readonly unknown[]
  error: unknown
}

export interface BeforeQueryEvent {
  /** Mutable — listeners may rewrite sql / parameters before execution. */
  sql: string
  parameters: unknown[]
}

export interface TransactionEvent {
  isolation?: 'serializable' | 'repeatable read' | 'read committed' | 'read uncommitted'
}

export interface TransactionRollbackEvent extends TransactionEvent {
  error: unknown
}

/** Fired before a transaction is run again after a retryable failure. */
export interface TransactionRetryEvent extends TransactionEvent {
  /** The attempt about to run — `2` is the first retry. */
  attempt: number
  /** What failed the previous attempt (a serialization failure or deadlock). */
  error: unknown
  delayMs: number
}

/** Options for `transaction(opts, fn)`. */
export interface TransactionOptions extends TransactionEvent {
  /**
   * What to do when a transaction is already open on this call chain:
   *
   * - `'reuse'` (default) — run inside it; the outer one commits or rolls back.
   * - `'savepoint'` — run inside it behind a savepoint, so a throw undoes only this part.
   * - `'separate'` — open an independent transaction on another connection.
   *
   * `isolation` and `retry` apply only when a transaction actually starts.
   */
  nested?: 'reuse' | 'savepoint' | 'separate'
  /**
   * Start the transaction read-only (Postgres, MySQL): a write inside it fails.
   * For reports that must see one consistent view and must not change it.
   * SQLite has no read-only transactions, so it's refused there.
   */
  readOnly?: boolean
  /**
   * Run the transaction as this role (`SET LOCAL ROLE`, Postgres): row-level
   * security policies `TO` that role apply. The connection's own role must be
   * a member of it.
   */
  role?: string
  /**
   * Settings for this transaction only (`set_config(key, value, true)`,
   * Postgres), for policies to read with `current_setting('app.user_id')`.
   * Keys need a dot (`app.user_id`). Values are bound, never spliced into SQL.
   */
  settings?: Record<string, string | number | boolean>
  /**
   * Run the whole transaction again when it fails with a retryable error —
   * a serialization failure or deadlock (`err.retryable`). `true` is three
   * attempts; waits between them back off exponentially with jitter.
   *
   * The callback runs once per attempt, so keep side effects outside the
   * database in `afterCommit`.
   */
  retry?: boolean | number | { attempts: number; baseDelayMs?: number; maxDelayMs?: number }
}

/**
 * Fired when a query exceeds `createDbClient({ slowQueryThresholdMs })`.
 * The `query` event ALSO fires for the same query — `slowQuery` is a
 * separate channel so listeners can subscribe to slow ones only
 * without filtering every query themselves.
 */
export interface SlowQueryEvent extends QueryEvent {
  /** The configured threshold the query exceeded. */
  thresholdMs: number
}

export interface KickDbClientEvents {
  beforeQuery: BeforeQueryEvent
  query: QueryEvent
  queryError: QueryErrorEvent
  slowQuery: SlowQueryEvent
  transactionStart: TransactionEvent
  transactionCommit: TransactionEvent
  transactionRollback: TransactionRollbackEvent
  transactionRetry: TransactionRetryEvent
}

/**
 * KickDbClient wraps a Kysely instance with three additions:
 *
 * 1. Lifecycle events (`on('query', ...)` etc) for observability + RLS
 *    rewriting via `beforeQuery`.
 * 2. transaction(fn) / transaction(opts, fn) — passes a fully-scoped child
 *    client whose mutations are isolated.
 * 3. tx.savepoint(fn) — nested rollback boundary inside an outer transaction.
 *
 * The underlying query builder is exposed as `db.qb` for advanced cases
 * that need APIs not surfaced through the wrapper. Adopters typically
 * never reach for `qb` — `selectFrom` / `insertInto` / etc. cover the
 * common query surface.
 *
 * NB: Rather than re-typing every query method on this surface, we
 * directly expose `selectFrom`/`insertInto`/`updateTable`/`deleteFrom`
 * as bound functions of the underlying builder — keeps us in sync with
 * upstream type evolution without manual mirroring.
 */
export interface KickDbClient<DB = RegisteredDB> {
  /** Underlying query builder — escape hatch for advanced cases. */
  readonly qb: Kysely<DB>
  readonly dialect: 'postgres' | 'sqlite' | 'mysql'

  selectFrom: Kysely<DB>['selectFrom']
  /**
   * Start a query with a common table expression. Takes Kysely's
   * `(name, query)`, or a CTE made once with `cte()` and spread in:
   * `db.with(...recent).selectFrom('recent')`. Runs on the primary.
   */
  with: Kysely<DB>['with']
  withRecursive: Kysely<DB>['withRecursive']
  /**
   * A named CTE to reuse across queries: `const recent = db.cte('recent', (q) =>
   * q.selectFrom('posts').where(…))`, then `db.with(...recent)`. Typed from
   * the query; works with any client of the same schema.
   */
  cte<N extends string, E extends CommonTableExpression<DB, N>>(name: N, query: E): readonly [N, E]
  insertInto: Kysely<DB>['insertInto']
  updateTable: Kysely<DB>['updateTable']
  deleteFrom: Kysely<DB>['deleteFrom']

  /**
   * Relational query namespace — `db.query.users.findMany({ with: {
   * posts: true } })`. PG-only in v1; SQLite + MySQL adopters get a
   * `RelationalQueryNotSupportedError` on first call. The shape is
   * inferred from the local `DB` generic (which itself defaults to
   * `RegisteredDB` so adopters using the bare `KickDbClient` still
   * see the right table set).
   *
   * Available `with` keys come from the `KickDbRelationsRegister`
   * augmentation emitted by the kick/db typegen plugin alongside
   * the column-shape augmentation.
   */
  readonly query: QueryNamespace<DB>

  on<E extends keyof KickDbClientEvents>(
    event: E,
    listener: (e: KickDbClientEvents[E]) => void | Promise<void>,
  ): this

  off<E extends keyof KickDbClientEvents>(
    event: E,
    listener: (e: KickDbClientEvents[E]) => void | Promise<void>,
  ): this

  /**
   * Insert, or update the rows whose `target` key already exists — one
   * statement (`ON CONFLICT … DO UPDATE` / `ON DUPLICATE KEY UPDATE`).
   * Returns the rows as stored.
   *
   *   await db.upsert('users', { values: { email, name }, target: ['email'] })
   */
  upsert<T extends keyof DB & string>(
    table: T,
    opts: import('./upsert').UpsertOptions<DB, T> & { values: Insertable<DB[T]> },
  ): Promise<Selectable<DB[T]>>
  upsert<T extends keyof DB & string>(
    table: T,
    opts: import('./upsert').UpsertOptions<DB, T> & { values: ReadonlyArray<Insertable<DB[T]>> },
  ): Promise<Selectable<DB[T]>[]>

  /**
   * The row matching `where`, or a new one from `where` + `create`;
   * `created` says which. Race-safe across concurrent requests.
   *
   *   const { row, created } = await db.findOrCreate('tags', { where: { name: 'urgent' } })
   */
  findOrCreate<T extends keyof DB & string, W extends Partial<Selectable<DB[T]>>>(
    table: T,
    opts: import('./upsert').FindOrCreateOptions<DB, T, W>,
  ): Promise<{ row: Selectable<DB[T]>; created: boolean }>

  /**
   * Re-run a materialized view's query and store the new result (Postgres).
   * `concurrently: true` keeps the view readable while it refreshes; it
   * needs a unique index on the view, and can't run inside a transaction.
   */
  refreshMaterializedView(
    name: keyof DB & string,
    options?: { concurrently?: boolean },
  ): Promise<void>

  transaction<T>(fn: (tx: KickDbClient<DB>) => Promise<T>): Promise<T>
  transaction<T>(opts: TransactionOptions, fn: (tx: KickDbClient<DB>) => Promise<T>): Promise<T>

  savepoint<T>(fn: (sp: KickDbClient<DB>) => Promise<T>): Promise<T>

  /**
   * Run `fn` once the current transaction commits — send the email, publish
   * the event. Dropped if it rolls back (or the savepoint it was registered
   * in does). Outside a transaction, runs right away.
   *
   * A hook that throws is reported to the error observers; the transaction
   * stays committed.
   */
  afterCommit(fn: () => unknown): Promise<void>

  /** Whether this call chain is inside a transaction. */
  readonly inTransaction: boolean

  /**
   * This client with every read on the primary — for reading what you just
   * wrote when replicas lag. The same client when there are no replicas.
   */
  readonly primary: KickDbClient<DB>

  /**
   * Returns a wrapped client carrying adopter-defined per-table
   * methods. Inside each method, `this` is the extended client so
   * call-chains stay clean:
   *
   *   const dbX = db.$extends({
   *     model: {
   *       users: {
   *         findByEmail(this: typeof dbX, email: string) {
   *           return this.selectFrom('users')
   *             .where('email', '=', email)
   *             .executeTakeFirst()
   *         },
   *       },
   *     },
   *   })
   *
   *   await dbX.users.findByEmail('a@b.com')
   *
   * Result extensions (`compute()` over selected rows) and the
   * insert-side toDriver pass land as follow-ups; v1 ships model
   * methods only.
   */
  $extends<E extends import('../extend/types').ExtensionDefinition<DB>>(
    ext: E,
  ): import('../extend/types').ExtendedClient<DB, E>

  destroy(): Promise<void>
}

export interface CreateDbClientOptions<TSchema, _DB = unknown> {
  /** Schema record — only used for type inference (M2-S1 tightens). */
  schema: TSchema
  /**
   * A Kysely dialect: `pgDialect` / `mysqlDialect` / `sqliteDialect`, or any
   * Kysely dialect (Neon, D1, libsql, `bun:sqlite`, PlanetScale…).
   */
  dialect: KyselyDialect
  /**
   * Which SQL `dialect` speaks, when it can't be told from the dialect:
   * kick/db's own dialects say so, and others are recognised by their
   * Kysely adapter. A dialect that's neither throws until this is set.
   */
  dialectTag?: 'postgres' | 'mysql' | 'sqlite'
  /**
   * Keep tenants apart: the same `defineTenancy()` the schema's
   * `tenantKey()` columns use. See {@link import('../tenancy').defineTenancy}.
   */
  tenancy?: import('../tenancy').Tenancy
  /**
   * Read replicas — a dialect, or several used in turn. Reads outside a
   * transaction (`selectFrom`, `db.query`) go to a replica; writes, raw
   * `db.qb`, and everything inside a transaction go to `dialect`. Read your
   * own writes through `db.primary`.
   */
  replica?: KyselyDialect | readonly KyselyDialect[]
  /**
   * Enable lifecycle event emission for `query` / `queryError` /
   * `slowQuery` / `transactionStart` / `transactionCommit` /
   * `transactionRollback`. Default `false` — zero overhead path; the
   * Kysely log callback isn't even installed.
   */
  events?: boolean
  /**
   * Fire the `slowQuery` event for any query whose duration exceeds
   * this threshold (milliseconds). Default `null` — no slow-query
   * detection. Setting a value implies `events: true` so the listener
   * surface is attached.
   */
  slowQueryThresholdMs?: number | null
  /**
   * Optional KickEventBus instance the client republishes lifecycle
   * events to. When set, the bus receives:
   *
   *   - `db:slow-query` — fired alongside the local `slowQuery` event;
   *     payload `{ sql, parameters, durationMs, thresholdMs }`.
   *   - `db:query-error` — fired alongside the local `queryError`
   *     event; payload `{ sql, parameters, error }`.
   *
   * Setting a bus implies `events: true` (the publisher hangs off the
   * existing emitter). Wire it from `DEVTOOLS_BUS` if you want the
   * DevTools panel to pick the events up:
   *
   *   import { DEVTOOLS_BUS } from '@forinda/kickjs-devtools-kit/bus/token'
   *   // Resolve only when devtools is actually wired — adopters who
   *   // skip @forinda/kickjs-devtools never register the token, and
   *   // resolve() throws on missing tokens.
   *   const db = createDbClient({
   *     ...,
   *     bus: container.has(DEVTOOLS_BUS) ? container.resolve(DEVTOOLS_BUS) : undefined,
   *     slowQueryThresholdMs: 100,
   *   })
   *
   * Type imported via `import type` so kickjs-db keeps devtools-kit
   * as an optional peer; adopters who skip devtools never load the
   * bus module.
   */
  bus?: import('@forinda/kickjs-devtools-kit/bus').KickEventBus
  /**
   * Extra Kysely plugins appended to the internal chain. Kickjs-db
   * still installs its own plugins (`CodecPlugin` for `customType`
   * mappers, `ParseJSONResultsPlugin` for SQLite + MySQL JSON
   * decoding); adopter plugins run after them in the order supplied.
   *
   * Use this for JSON column rewriters, soft-delete filters,
   * instrumentation, or any other `KyselyPlugin`. Empty / unset =
   * byte-identical chain to pre-M5.B clients (only the built-in
   * plugins run).
   *
   * Reach for `safeNullComparison()` here when you want
   * `eb('col', '=', null)` to compile to `IS NULL` instead of the
   * silently-false `= NULL`:
   *
   * ```ts
   * import { createDbClient, safeNullComparison } from '@forinda/kickjs-db'
   *
   * const db = createDbClient({
   *   schema,
   *   dialect: pgDialect({ pool }),
   *   plugins: [safeNullComparison()],
   * })
   * ```
   *
   * **Heads-up — pass `safeNullComparison()` from
   * `@forinda/kickjs-db`, NOT Kysely's `SafeNullComparisonPlugin`.**
   * Kysely 0.29's upstream version is broken on PG (rewrites the
   * operator but keeps the null operand parameterised, producing
   * `WHERE "col" IS $1` which PG rejects with `syntax error at or
   * near "$1"`). The kickjs version emits the literal `null` keyword
   * inline. Tracked upstream at <https://github.com/forinda/kick-js/issues/220>.
   */
  plugins?: KyselyPlugin[]
  /**
   * `'snake_case'`: tables and columns are snake_case in the database and
   * camelCase in TypeScript — `firstName` is the `first_name` column. Set the
   * same `casing` in `kick.config.ts` so migrations use those names.
   */
  casing?: 'snake_case'
}
