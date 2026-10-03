import { AsyncLocalStorage } from 'node:async_hooks'
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
 */
export type TenancyStrategy = 'column' | 'rls' | 'schema'

export interface TenancyOptions {
  strategy: TenancyStrategy
  /**
   * The current tenant's id outside `run()`: typically read from the request,
   * `() => getRequestValue('tenant')?.id`. `undefined` means no tenant.
   */
  current?: () => string | undefined
  /** `'rls'`: the setting the policy reads. Default `app.tenant_id`. */
  setting?: string
  /** `'schema'`: the schema for a tenant. Default `tenant_<id>`. */
  schemaFor?: (tenantId: string) => string
}

export interface Tenancy extends Readonly<Required<Omit<TenancyOptions, 'current'>>> {
  readonly __isTenancy: true
  /** Run `fn` as `tenantId` — jobs, cron, scripts, tests. Nested runs switch tenant. */
  run<T>(tenantId: string, fn: () => T): T
  /**
   * Run `fn` across every tenant: no tenant filter (`'column'`), no schema
   * switch (`'schema'`). For admin work and cross-tenant reports. With
   * `'rls'` the database decides: connect as a role that bypasses the policy.
   */
  bypass<T>(fn: () => T): T
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
export function defineTenancy(options: TenancyOptions): Tenancy {
  const scope = new AsyncLocalStorage<{ id: string | null }>()
  return {
    __isTenancy: true,
    strategy: options.strategy,
    setting: options.setting ?? 'app.tenant_id',
    schemaFor: options.schemaFor ?? ((id) => `tenant_${id}`),
    run: (tenantId, fn) => scope.run({ id: tenantId }, fn),
    bypass: (fn) => scope.run({ id: null }, fn),
    current: () => {
      const store = scope.getStore()
      return store ? store.id : options.current?.()
    },
  }
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
  if (tenancy.strategy === 'schema') {
    throw new Error(`kickjs-db: tenantKey() is for 'column' and 'rls' tenancy; 'schema' needs none`)
  }
  const state = (column as unknown as { state: { nullable: boolean; tenancy?: Tenancy } }).state
  state.nullable = false
  state.tenancy = tenancy
  return column as ColumnBuilder<T> & NotNullBrand & GeneratedBrand
}
