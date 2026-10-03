import { AsyncLocalStorage } from 'node:async_hooks'
import { registerJobContext, requestStore } from '@forinda/kickjs'
import type { Dialect } from 'kysely'
import { ColumnBuilder, type GeneratedBrand, type NotNullBrand } from './dsl/columns/types'

/**
 * How tenants' rows are kept apart:
 *
 * - `'column'` — shared tables, a tenant column; kick/db adds the tenant to
 *   every query on a tenanted table and fills it on insert.
 * - `'rls'` — shared tables, a tenant column, and a Postgres policy per
 *   tenanted table; kick/db hands each connection the current tenant, so
 *   the database filters.
 * - `'schema'` — a Postgres schema per tenant; kick/db points each query at
 *   the tenant's schema.
 * - `'database'` — a database per tenant (any dialect: a Postgres database,
 *   a SQLite / libsql / D1 file per tenant); kick/db sends each query to the
 *   tenant's database. `bypass()` uses the client's own `dialect` — the
 *   central database.
 */
export type TenancyStrategy = 'column' | 'rls' | 'schema' | 'database'

export interface TenancyOptions {
  strategy: TenancyStrategy
  /**
   * The current tenant's id outside `run()`. Default: the request's `tenant`
   * value (what a `LoadTenant` context contributor sets) — its `id`, or the
   * value itself when it's a string. `undefined` means no tenant.
   */
  current?: () => string | undefined
  /** `'rls'`: the setting the policy reads. Default `app.tenant_id`. */
  setting?: string
  /** `'schema'`: the schema for a tenant. Default `tenant_<id>`. */
  schemaFor?: (tenantId: string) => string
  /**
   * `'database'`: the dialect for a tenant's database. Called once per
   * tenant; its connections are kept for the client's life (closed by
   * `db.destroy()`).
   */
  dialectFor?: (tenantId: string) => Dialect
  /**
   * `'database'`: close a tenant's connections after this long unused.
   * Default 10 minutes; `0` keeps them for the client's life.
   */
  tenantIdleMs?: number
  /**
   * `'database'`: at most this many tenants' connections open at once — the
   * least recently used idle one is closed to make room. A soft cap: tenants
   * with a query in flight are never closed. Default unlimited.
   */
  maxOpenTenants?: number
  /**
   * `'rls'`: how a connection gets the tenant.
   *
   * - `'transaction'` (default) — `set_config(…, true)`, local to a
   *   transaction: a query outside one runs in its own short transaction.
   *   Safe behind a transaction-mode pooler (PgBouncer, Supavisor, Neon's
   *   pooler), which hands a server connection to another client between
   *   transactions.
   * - `'connection'` — `set_config(…, false)` on the connection when it's
   *   handed out, only when the tenant changes: fewer round trips, but only
   *   for a pool that owns its connections (node-postgres' `Pool`, a direct
   *   connection). Behind a transaction-mode pooler the setting would leak to
   *   whoever gets the connection next.
   */
  binding?: 'transaction' | 'connection'
  /**
   * `'rls'`: a dialect connecting as a role that bypasses row-level security
   * (`BYPASSRLS`, e.g. the migration role) — what `bypass()` runs on. Without
   * it, `bypass()` throws under `'rls'`: there's no safe way for the app's own
   * role to switch policies off (a flag any SQL can set is one injection away).
   */
  bypassDialect?: Dialect
  /** Called on every `bypass()`, for an audit log. */
  onBypass?: (info: BypassInfo) => void
  /**
   * `'rls'`: what to do when the app's role would skip the policies anyway —
   * a superuser or `BYPASSRLS` role. Checked on the first connection.
   * Default `'error'`.
   */
  roleCheck?: 'error' | 'warn' | 'off'
}

export interface BypassInfo {
  reason: string
  strategy: TenancyStrategy
  /** Where `bypass()` was called. */
  stack: string | undefined
}

export interface BypassOptions {
  /** Why — passed to `onBypass`, for the audit log. */
  reason: string
  /** Allow it inside an HTTP request (refused there by default). */
  allowInRequest?: boolean
}

export interface Tenancy extends Readonly<
  Required<Pick<TenancyOptions, 'strategy' | 'setting' | 'schemaFor' | 'binding' | 'roleCheck'>>
> {
  readonly bypassDialect?: Dialect
  readonly dialectFor?: (tenantId: string) => Dialect
  readonly tenantIdleMs: number
  readonly maxOpenTenants: number
  readonly __isTenancy: true
  /** Run `fn` as `tenantId` — jobs, cron, scripts, tests. Nested runs switch tenant. */
  run<T>(tenantId: string, fn: () => T): T
  /**
   * Run `fn` across every tenant — admin work, cross-tenant reports: no tenant
   * filter (`'column'`), no schema switch (`'schema'`), the `bypassDialect`'s
   * connections (`'rls'`). Needs a reason, reported to `onBypass`, and is
   * refused inside an HTTP request unless `allowInRequest`.
   */
  bypass<T>(fn: () => T, options: BypassOptions): T
  /** The tenant in effect: an id, `null` inside `bypass()`, or `undefined` for none. */
  current(): string | null | undefined
}

/** Thrown when a tenanted table is queried with no tenant in effect. */
export class TenantRequiredError extends Error {
  constructor(table: string) {
    super(
      `kickjs-db: '${table}' is tenanted and no tenant is in effect — run inside ` +
        `tenancy.run(id, fn), a request with a tenant, or tenancy.bypass(fn)`,
    )
    this.name = 'TenantRequiredError'
  }
}

/** The request's `tenant` value as an id: `{ id }` or a string. */
function requestTenant(): string | undefined {
  const value = requestStore.getStore()?.values.get('tenant') as unknown
  if (typeof value === 'string') return value
  const id = (value as { id?: unknown } | undefined)?.id
  return id === undefined || id === null ? undefined : String(id)
}

/**
 * One description of how tenants are separated, shared by the schema
 * (`tenantKey(tenancy)`) and the client (`createDbClient({ tenancy })`).
 *
 * ```ts
 * export const tenancy = defineTenancy({
 *   strategy: 'rls',
 *   current: () => getRequestValue('tenant')?.id,
 * })
 * ```
 */
let tenancies = 0

export function defineTenancy(options: TenancyOptions): Tenancy {
  if (options.strategy === 'database' && !options.dialectFor) {
    throw new Error("kickjs-db: 'database' tenancy needs dialectFor(tenantId)")
  }
  const scope = new AsyncLocalStorage<{ id: string | null }>()
  const tenancy: Tenancy = {
    __isTenancy: true,
    strategy: options.strategy,
    setting: options.setting ?? 'app.tenant_id',
    schemaFor: options.schemaFor ?? ((id) => `tenant_${id}`),
    binding: options.binding ?? 'transaction',
    roleCheck: options.roleCheck ?? 'error',
    bypassDialect: options.bypassDialect,
    dialectFor: options.dialectFor,
    tenantIdleMs: options.tenantIdleMs ?? 600_000,
    maxOpenTenants: options.maxOpenTenants ?? Number.POSITIVE_INFINITY,
    run: (tenantId, fn) => scope.run({ id: tenantId }, fn),
    bypass: (fn, bypassOptions) => {
      if (!bypassOptions?.reason) {
        throw new Error(
          'kickjs-db: tenancy.bypass(fn, { reason }) needs a reason, for the audit log',
        )
      }
      if (options.strategy === 'rls' && !options.bypassDialect) {
        throw new Error(
          "kickjs-db: bypass() under 'rls' needs a bypassDialect — a connection as a role that bypasses row-level security",
        )
      }
      if (requestStore.getStore() && !bypassOptions.allowInRequest) {
        throw new Error(
          'kickjs-db: tenancy.bypass() inside an HTTP request — pass allowInRequest: true if this route is meant to see every tenant',
        )
      }
      options.onBypass?.({
        reason: bypassOptions.reason,
        strategy: options.strategy,
        stack: new Error().stack?.split('\n').slice(2).join('\n'),
      })
      return scope.run({ id: null }, fn)
    },
    current: () => {
      const store = scope.getStore()
      return store ? store.id : (options.current ?? requestTenant)()
    },
  }
  // A job dispatched as a tenant runs as it.
  registerJobContext<string>({
    key: `kick/db/tenant/${++tenancies}`,
    capture: () => tenancy.current() ?? undefined,
    restore: (tenantId, run) => tenancy.run(tenantId, run),
  })
  return tenancy
}

/**
 * The tenant column of a tenanted table — what marks it tenanted. Filled
 * from the current tenant on insert, so it's optional there.
 *
 * ```ts
 * export const notes = table('notes', {
 *   id: serial().primaryKey(),
 *   tenantId: tenantKey(tenancy),
 *   body: text().notNull(),
 * })
 * ```
 *
 * With `'rls'` the table also gets row-level security, forced (the app
 * usually connects as the owner), and a policy matching the column to the
 * setting. Pass another column to change its type: `tenantKey(tenancy, uuid())`.
 */
export function tenantKey<T = string>(
  tenancy: Tenancy,
  column: ColumnBuilder<T> = new ColumnBuilder<string>('text') as unknown as ColumnBuilder<T>,
): ColumnBuilder<T> & NotNullBrand & GeneratedBrand {
  if (tenancy.strategy === 'schema' || tenancy.strategy === 'database') {
    throw new Error(
      `kickjs-db: tenantKey() is for 'column' and 'rls' tenancy; '${tenancy.strategy}' needs none`,
    )
  }
  const state = (column as unknown as { state: { nullable: boolean; tenancy?: Tenancy } }).state
  state.nullable = false
  state.tenancy = tenancy
  return column as ColumnBuilder<T> & NotNullBrand & GeneratedBrand
}
