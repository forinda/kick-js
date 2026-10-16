/** 'column' tenancy on SQLite with a uuid, ULID (varchar(26)) or integer tenant column. */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  defineTenancy,
  diff,
  emitSqlite,
  extractSnapshot,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'
import {
  tenantKeyCases,
  tenantKeyFlow,
  tenantKeyNamings,
  tenantKeySchema,
} from '../setup/tenant-key-types'

describe.each(tenantKeyCases)("'column' tenancy, $name tenant column", (c) => {
  it('fills, filters, joins and checks the tenant', async () => {
    const tenancy = defineTenancy({ strategy: 'column' })
    const schema = tenantKeySchema(tenancy, c)
    const database = new Database(':memory:')
    const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
    const target = extractSnapshot(schema, 'sqlite')
    database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
    const db = createDbClient({ schema, tenancy, dialect: sqliteDialect({ database }) })
    await tenantKeyFlow(db, tenancy, c)
  })
})

describe.each(tenantKeyNamings)("'column' tenancy, tenant column named by $name", (naming) => {
  it('filters and fills the column under its database name', async () => {
    const c = tenantKeyCases.find((k) => k.name === 'integer()')!
    const tenancy = defineTenancy({ strategy: 'column' })
    const schema = tenantKeySchema(tenancy, c, naming)
    const database = new Database(':memory:')
    const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
    const target = extractSnapshot(schema, 'sqlite', { casing: naming.casing })
    const ddl = emitSqlite(diff(empty, target), { from: empty, to: target })
    expect(ddl).toContain(`"${naming.dbName}"`)
    database.exec(ddl)
    const db = createDbClient({
      schema,
      tenancy,
      casing: naming.casing,
      dialect: sqliteDialect({ database }),
    })
    await tenantKeyFlow(db, tenancy, c, naming.key)
    const raw = database.prepare(`SELECT "${naming.dbName}" AS t FROM projects ORDER BY id`).all()
    expect(raw).toEqual([{ t: 1 }, { t: 2 }, { t: 1 }])
  })
})
