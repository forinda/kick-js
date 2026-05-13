import type { Kysely, Dialect as KyselyDialect, KyselyPlugin } from 'kysely'

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

  transaction<T>(fn: (tx: KickDbClient<DB>) => Promise<T>): Promise<T>
  transaction<T>(opts: TransactionEvent, fn: (tx: KickDbClient<DB>) => Promise<T>): Promise<T>

  savepoint<T>(fn: (sp: KickDbClient<DB>) => Promise<T>): Promise<T>

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
  /** A Kysely Dialect — typically PostgresDialect from db-pg. */
  dialect: KyselyDialect
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
   * Any `KyselyPlugin` works — JSON column rewriters, soft-delete
   * filters, instrumentation. Empty / unset = byte-identical chain
   * to pre-M5.B clients (only the built-in plugins run).
   */
  plugins?: KyselyPlugin[]
}
