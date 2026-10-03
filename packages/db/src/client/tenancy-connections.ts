import {
  CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
  type TransactionSettings,
} from 'kysely'
import { TenantRequiredError, type Tenancy } from '../tenancy'

/**
 * `'rls'` tenancy, on connections:
 *
 * - The app's connections carry the current tenant in `tenancy.setting`:
 *   per transaction (`set_config(…, true)`; a lone query gets its own short
 *   transaction), or, with `binding: 'connection'`, per connection
 *   (`set_config(…, false)`, sent only when the tenant changes).
 * - Inside `bypass()`, connections come from `bypassDialect` instead — a role
 *   that bypasses row-level security — tagged `application_name = kick-bypass`.
 * - The first app connection checks the role isn't a superuser or
 *   `BYPASSRLS`, which would skip the policies silently (`roleCheck`).
 */
export function tenantConnections(dialect: Dialect, tenancy: Tenancy | undefined): Dialect {
  if (tenancy?.strategy === 'database') {
    return {
      createAdapter: () => dialect.createAdapter(),
      createQueryCompiler: () => dialect.createQueryCompiler(),
      createIntrospector: (db) => dialect.createIntrospector(db),
      createDriver: () => new DatabaseRouter(dialect.createDriver(), tenancy),
    }
  }
  if (tenancy?.strategy !== 'rls') return dialect
  return {
    createAdapter: () => dialect.createAdapter(),
    createQueryCompiler: () => dialect.createQueryCompiler(),
    createIntrospector: (db) => dialect.createIntrospector(db),
    createDriver: () =>
      new TenantDriver(dialect.createDriver(), tenancy.bypassDialect?.createDriver(), tenancy),
  }
}

const raw = (sql: string, parameters: unknown[] = []) => CompiledQuery.raw(sql, parameters)

/** An app connection under transaction binding: every statement runs with the tenant set locally. */
class TenantConnection implements DatabaseConnection {
  inTransaction = false

  constructor(
    readonly inner: DatabaseConnection,
    private readonly setting: string,
    private readonly tenant: string,
  ) {}

  /** Set the tenant for the transaction just begun. */
  bind(): Promise<QueryResult<unknown>> {
    return this.inner.executeQuery(
      raw('select set_config($1, $2, true)', [this.setting, this.tenant]),
    )
  }

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    if (this.inTransaction) return this.inner.executeQuery<R>(query)
    // A query on its own: wrap it, so the local setting has a transaction to live in.
    await this.inner.executeQuery(raw('begin'))
    try {
      await this.bind()
      const result = await this.inner.executeQuery<R>(query)
      await this.inner.executeQuery(raw('commit'))
      return result
    } catch (err) {
      await this.inner.executeQuery(raw('rollback')).catch(() => {})
      throw err
    }
  }

  async *streamQuery<R>(
    query: CompiledQuery,
    chunkSize: number,
  ): AsyncIterableIterator<QueryResult<R>> {
    if (this.inTransaction) {
      yield* this.inner.streamQuery<R>(query, chunkSize)
      return
    }
    await this.inner.executeQuery(raw('begin'))
    try {
      await this.bind()
      yield* this.inner.streamQuery<R>(query, chunkSize)
      await this.inner.executeQuery(raw('commit'))
    } catch (err) {
      await this.inner.executeQuery(raw('rollback')).catch(() => {})
      throw err
    }
  }
}

class TenantDriver implements Driver {
  /** Which driver each handed-out connection came from. */
  private readonly owner = new WeakMap<DatabaseConnection, Driver>()
  /** `'connection'` binding: the tenant each connection was last set to. */
  private readonly bound = new WeakMap<DatabaseConnection, string>()
  private readonly tagged = new WeakSet<DatabaseConnection>()
  private roleChecked: Promise<void> | undefined

  constructor(
    private readonly app: Driver,
    private readonly bypass: Driver | undefined,
    private readonly tenancy: Tenancy,
  ) {}

  async init(options?: Parameters<Driver['init']>[0]): Promise<void> {
    await this.app.init(options)
    await this.bypass?.init(options)
  }

  async acquireConnection(
    options?: Parameters<Driver['acquireConnection']>[0],
  ): Promise<DatabaseConnection> {
    const tenant = this.tenancy.current()
    if (tenant === null) {
      if (!this.bypass) throw new Error("kickjs-db: bypass() under 'rls' needs a bypassDialect")
      const conn = await this.bypass.acquireConnection(options)
      this.owner.set(conn, this.bypass)
      if (!this.tagged.has(conn)) {
        // Visible in pg_stat_activity and the server log as the bypass.
        await conn.executeQuery(raw(`select set_config('application_name', 'kick-bypass', false)`))
        this.tagged.add(conn)
      }
      return conn
    }

    const conn = await this.app.acquireConnection(options)
    this.owner.set(conn, this.app)
    try {
      await (this.roleChecked ??= this.checkRole(conn))
    } catch (err) {
      await this.app.releaseConnection(conn)
      throw err
    }
    if (this.tenancy.binding === 'connection') {
      const value = tenant ?? ''
      if (this.bound.get(conn) !== value) {
        await conn.executeQuery(
          raw('select set_config($1, $2, false)', [this.tenancy.setting, value]),
        )
        this.bound.set(conn, value)
      }
      return conn
    }
    const wrapped = new TenantConnection(conn, this.tenancy.setting, tenant ?? '')
    this.owner.set(wrapped, this.app)
    return wrapped
  }

  /** The policies don't apply to a superuser or BYPASSRLS role: say so before it matters. */
  private async checkRole(conn: DatabaseConnection): Promise<void> {
    if (this.tenancy.roleCheck === 'off') return
    const { rows } = await conn.executeQuery<{ rolsuper: boolean; rolbypassrls: boolean }>(
      raw('select rolsuper, rolbypassrls from pg_roles where rolname = current_user'),
    )
    const role = rows[0]
    if (!role?.rolsuper && !role?.rolbypassrls) return
    const message =
      `kickjs-db: the app connects as a ${role.rolsuper ? 'superuser' : 'BYPASSRLS role'}, ` +
      `which row-level security never applies to — every tenant's rows are visible. ` +
      `Connect as an ordinary role (roleCheck: 'warn' or 'off' to allow it).`
    if (this.tenancy.roleCheck === 'error') {
      this.roleChecked = undefined // checked again next time, not cached as passed
      throw new Error(message)
    }
    console.warn(message)
  }

  private unwrap(conn: DatabaseConnection): DatabaseConnection {
    return conn instanceof TenantConnection ? conn.inner : conn
  }

  private driverOf(conn: DatabaseConnection): Driver {
    return this.owner.get(conn) ?? this.app
  }

  async beginTransaction(conn: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    await this.driverOf(conn).beginTransaction(this.unwrap(conn), settings)
    if (conn instanceof TenantConnection) {
      await conn.bind()
      conn.inTransaction = true
    }
  }

  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    if (conn instanceof TenantConnection) conn.inTransaction = false
    await this.driverOf(conn).commitTransaction(this.unwrap(conn))
  }

  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    if (conn instanceof TenantConnection) conn.inTransaction = false
    await this.driverOf(conn).rollbackTransaction(this.unwrap(conn))
  }

  async savepoint(conn: DatabaseConnection, name: string, compile: any): Promise<void> {
    await this.driverOf(conn).savepoint!(this.unwrap(conn), name, compile)
  }

  async rollbackToSavepoint(conn: DatabaseConnection, name: string, compile: any): Promise<void> {
    await this.driverOf(conn).rollbackToSavepoint!(this.unwrap(conn), name, compile)
  }

  async releaseSavepoint(conn: DatabaseConnection, name: string, compile: any): Promise<void> {
    await this.driverOf(conn).releaseSavepoint!(this.unwrap(conn), name, compile)
  }

  async releaseConnection(
    conn: DatabaseConnection,
    options?: Parameters<Driver['releaseConnection']>[1],
  ): Promise<void> {
    await this.driverOf(conn).releaseConnection(this.unwrap(conn), options)
  }

  async destroy(options?: Parameters<Driver['destroy']>[0]): Promise<void> {
    await this.app.destroy(options)
    await this.bypass?.destroy(options)
  }
}

/**
 * `'database'` tenancy: each tenant's queries go to its own database,
 * through a driver created on the tenant's first query and kept. `bypass()`
 * uses the central database (the client's own dialect).
 */
class DatabaseRouter implements Driver {
  private readonly owner = new WeakMap<DatabaseConnection, Driver>()
  // ponytail: one driver per tenant for the client's life — add idle eviction
  // when a process serves more tenants than it can hold pools for.
  private readonly tenants = new Map<string, Promise<Driver>>()

  constructor(
    private readonly central: Driver,
    private readonly tenancy: Tenancy,
  ) {}

  init(options?: Parameters<Driver['init']>[0]): Promise<void> {
    return this.central.init(options)
  }

  private driverFor(tenant: string): Promise<Driver> {
    let driver = this.tenants.get(tenant)
    if (!driver) {
      driver = (async () => {
        const d = this.tenancy.dialectFor!(tenant).createDriver()
        await d.init()
        return d
      })()
      // A failed init isn't cached: the next query tries again.
      driver.catch(() => this.tenants.delete(tenant))
      this.tenants.set(tenant, driver)
    }
    return driver
  }

  async acquireConnection(
    options?: Parameters<Driver['acquireConnection']>[0],
  ): Promise<DatabaseConnection> {
    const tenant = this.tenancy.current()
    if (tenant === undefined) throw new TenantRequiredError('(any table)')
    const driver = tenant === null ? this.central : await this.driverFor(tenant)
    const conn = await driver.acquireConnection(options)
    this.owner.set(conn, driver)
    return conn
  }

  private of(conn: DatabaseConnection): Driver {
    return this.owner.get(conn) ?? this.central
  }

  beginTransaction(conn: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    return this.of(conn).beginTransaction(conn, settings)
  }

  commitTransaction(conn: DatabaseConnection): Promise<void> {
    return this.of(conn).commitTransaction(conn)
  }

  rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    return this.of(conn).rollbackTransaction(conn)
  }

  async savepoint(conn: DatabaseConnection, name: string, compile: any): Promise<void> {
    await this.of(conn).savepoint!(conn, name, compile)
  }

  async rollbackToSavepoint(conn: DatabaseConnection, name: string, compile: any): Promise<void> {
    await this.of(conn).rollbackToSavepoint!(conn, name, compile)
  }

  async releaseSavepoint(conn: DatabaseConnection, name: string, compile: any): Promise<void> {
    await this.of(conn).releaseSavepoint!(conn, name, compile)
  }

  releaseConnection(
    conn: DatabaseConnection,
    options?: Parameters<Driver['releaseConnection']>[1],
  ): Promise<void> {
    return this.of(conn).releaseConnection(conn, options)
  }

  async destroy(options?: Parameters<Driver['destroy']>[0]): Promise<void> {
    const drivers = await Promise.allSettled(this.tenants.values())
    this.tenants.clear()
    for (const d of drivers) if (d.status === 'fulfilled') await d.value.destroy(options)
    await this.central.destroy(options)
  }
}
