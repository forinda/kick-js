/** Tenancy: the 'database' strategy — a SQLite file per tenant, plus a central one. */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  TenantRequiredError,
  createDbClient,
  defineTenancy,
  diff,
  emitSqlite,
  extractSnapshot,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'
import { requestStore } from '@forinda/kickjs'

const notes = table('notes', { id: serial().primaryKey(), body: text().notNull() })
const schema = { notes }
const dir = mkdtempSync(path.join(tmpdir(), 'kick-tenants-'))

function database(file: string) {
  const db = new Database(path.join(dir, file))
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  db.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return db
}

describe("'database' tenancy", () => {
  it('sends each tenant to its own database, and bypass to the central one', async () => {
    const opened: string[] = []
    const tenancy = defineTenancy({
      strategy: 'database',
      dialectFor: (id) => {
        opened.push(id)
        return sqliteDialect({ database: database(`${id}.db`) })
      },
    })
    const db = createDbClient({
      schema,
      tenancy,
      dialect: sqliteDialect({ database: database('central.db') }),
    })
    try {
      await tenancy.run('acme', () => db.insertInto('notes').values({ body: 'a1' }).execute())
      await tenancy.run('globex', () => db.insertInto('notes').values({ body: 'g1' }).execute())
      await tenancy.run('acme', () => db.insertInto('notes').values({ body: 'a2' }).execute())
      expect(opened).toEqual(['acme', 'globex']) // one driver per tenant, reused

      expect(
        await tenancy.run('acme', () => db.selectFrom('notes').select('body').execute()),
      ).toEqual([{ body: 'a1' }, { body: 'a2' }])
      // Transactions stay on the tenant's database.
      await tenancy.run('globex', () =>
        db.transaction((tx) => tx.insertInto('notes').values({ body: 'g2' }).execute()),
      )
      expect(
        new Database(path.join(dir, 'globex.db')).prepare('select count(*) n from notes').get(),
      ).toEqual({ n: 2 })

      // The request's tenant, read from the request store by default.
      const fromRequest = await requestStore.run(
        {
          requestId: 'r',
          instances: new Map(),
          values: new Map([['tenant', { id: 'globex' }]]),
        } as never,
        () => db.selectFrom('notes').select('body').execute(),
      )
      expect(fromRequest).toHaveLength(2)

      expect(
        await tenancy.bypass(() => db.selectFrom('notes').selectAll().execute(), {
          reason: 'central',
        }),
      ).toEqual([])
      await expect(db.selectFrom('notes').selectAll().execute()).rejects.toBeInstanceOf(
        TenantRequiredError,
      )
    } finally {
      await db.destroy()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
