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

describe("'database' tenancy closes idle tenants", () => {
  it('keeps at most maxOpenTenants open, and closes one idle past tenantIdleMs', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kick-tenants-idle-'))
    const handles = new Map<string, Database.Database[]>()
    const open = (id: string) => {
      const db = new Database(path.join(root, `${id}.db`))
      db.exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
      handles.set(id, [...(handles.get(id) ?? []), db])
      return db
    }
    const tenancy = defineTenancy({
      strategy: 'database',
      maxOpenTenants: 2,
      tenantIdleMs: 50,
      dialectFor: (id) => sqliteDialect({ database: open(id) }),
    })
    const db = createDbClient({
      schema,
      tenancy,
      dialect: sqliteDialect({ database: new Database(':memory:') }),
    })
    const add = (id: string) =>
      tenancy.run(id, () => db.insertInto('notes').values({ body: id }).execute())
    try {
      await add('a')
      await add('b')
      await add('c') // over the cap: 'a', least recently used, is closed
      expect(handles.get('a')![0]!.open).toBe(false)
      expect(handles.get('b')![0]!.open).toBe(true)

      await add('a') // reopened, its data intact
      expect(handles.get('a')).toHaveLength(2)
      expect(await tenancy.run('a', () => db.selectFrom('notes').select('body').execute())).toEqual(
        [{ body: 'a' }, { body: 'a' }],
      )

      await new Promise((r) => setTimeout(r, 120))
      expect([...handles.values()].flat().every((h) => !h.open)).toBe(true)
    } finally {
      await db.destroy()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
