import { CompiledQuery, type DatabaseConnection, type Dialect } from 'kysely'
import type { Tenancy } from '../tenancy'

/**
 * `'rls'` tenancy: each connection is handed out set to the current tenant
 * (`set_config(setting, tenant, false)`), so the policies see it on every
 * query — no transaction per request. The setting is only sent when it
 * changes for that connection. It's set before Kysely's BEGIN, so a
 * rolled-back transaction can't undo it. With no tenant (or in `bypass()`)
 * it's `''`, which the generated policy matches to nothing.
 */
export function tenantConnections(dialect: Dialect, tenancy: Tenancy | undefined): Dialect {
  if (tenancy?.strategy !== 'rls') return dialect
  const current = new WeakMap<DatabaseConnection, string>()
  const set = CompiledQuery.raw('select set_config($1, $2, false)', [])
  return {
    createAdapter: () => dialect.createAdapter(),
    createQueryCompiler: () => dialect.createQueryCompiler(),
    createIntrospector: (db) => dialect.createIntrospector(db),
    createDriver: () => {
      const driver = dialect.createDriver()
      const acquire = driver.acquireConnection.bind(driver)
      driver.acquireConnection = async () => {
        const conn = await acquire()
        const tenant = tenancy.current() ?? ''
        if (current.get(conn) !== tenant) {
          await conn.executeQuery({ ...set, parameters: [tenancy.setting, tenant] })
          current.set(conn, tenant)
        }
        return conn
      }
      return driver
    },
  }
}
