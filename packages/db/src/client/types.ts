import type { Kysely, Dialect as KyselyDialect } from 'kysely'

import type { RegisteredDB } from './register'

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
 * The Kysely instance is exposed as `db.kysely` for advanced cases that need
 * Kysely-native APIs not surfaced here.
 *
 * NB: Rather than re-typing every Kysely method on this surface, we directly
 * expose `selectFrom`/`insertInto`/`updateTable`/`deleteFrom` as bound
 * functions of the underlying Kysely instance — that keeps us in sync with
 * Kysely's own type evolution without manual mirroring.
 */
export interface KickDbClient<DB = RegisteredDB> {
  readonly kysely: Kysely<DB>
  readonly dialect: 'postgres' | 'sqlite' | 'mysql'

  selectFrom: Kysely<DB>['selectFrom']
  insertInto: Kysely<DB>['insertInto']
  updateTable: Kysely<DB>['updateTable']
  deleteFrom: Kysely<DB>['deleteFrom']

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
}
