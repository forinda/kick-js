/** Tenancy experiment: the 'column' strategy on SQLite. */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { sql } from 'kysely'
import {
  TenantRequiredError,
  createDbClient,
  defineTenancy,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  relations,
  serial,
  table,
  tenantKey,
  text,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

let requestTenant: string | undefined
const tenancy = defineTenancy({ strategy: 'column', current: () => requestTenant })

const projects = table('projects', {
  id: serial().primaryKey(),
  tenantId: tenantKey(tenancy),
  name: text().notNull(),
})
const tasks = table('tasks', {
  id: serial().primaryKey(),
  tenantId: tenantKey(tenancy),
  projectId: integer().notNull(),
  title: text().notNull(),
})
const plans = table('plans', { id: serial().primaryKey(), name: text().notNull() }) // shared
const projectRelations = relations(projects, ({ many }) => ({ tasks: many(tasks) }))
const taskRelations = relations(tasks, ({ one }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
}))
const schema = { projects, tasks, plans, projectRelations, taskRelations }

function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  database.exec(`
    INSERT INTO projects (id, tenantId, name) VALUES (1, 'acme', 'Rocket'), (2, 'globex', 'Lasers');
    INSERT INTO tasks (tenantId, projectId, title) VALUES ('acme', 1, 'fuel'), ('globex', 2, 'aim'),
      ('globex', 1, 'planted by globex in acme''s project');
    INSERT INTO plans (name) VALUES ('free');
  `)
  return createDbClient({ schema, tenancy, dialect: sqliteDialect({ database }) })
}

describe("'column' tenancy", () => {
  it('scopes reads, joins, updates and deletes to the tenant', async () => {
    const db = make()
    await tenancy.run('acme', async () => {
      expect(await db.selectFrom('projects').select('name').execute()).toEqual([{ name: 'Rocket' }])
      // The joined table is filtered too, in its ON: a left join stays a left join.
      const joined = await db
        .selectFrom('projects')
        .leftJoin('tasks', 'tasks.projectId', 'projects.id')
        .select(['projects.name', 'tasks.title'])
        .execute()
      expect(joined).toEqual([{ name: 'Rocket', title: 'fuel' }])
      await db.updateTable('tasks').set({ title: 'refuel' }).execute()
      await db.deleteFrom('projects').where('name', '=', 'Lasers').execute() // another tenant's: untouched
    })
    const all = await tenancy.bypass(
      () => db.selectFrom('tasks').select('title').orderBy('id').execute(),
      { reason: 'test' },
    )
    expect(all.map((t) => t.title)).toEqual([
      'refuel',
      'aim',
      "planted by globex in acme's project",
    ])
    expect(
      await tenancy.bypass(() => db.selectFrom('projects').selectAll().execute(), {
        reason: 'test',
      }),
    ).toHaveLength(2)
    // Shared tables are left alone, with or without a tenant.
    expect(await db.selectFrom('plans').select('name').execute()).toEqual([{ name: 'free' }])
  })

  it('scopes every level of db.query', async () => {
    const db = make()
    const rocket = await tenancy.run('acme', () =>
      db.query.projects.findFirst({ with: { tasks: true } }),
    )
    expect(rocket?.tasks.map((t) => t.title)).toEqual(['fuel'])
  })

  it('fills the tenant on insert and refuses another tenant', async () => {
    const db = make()
    await tenancy.run('globex', async () => {
      await db
        .insertInto('projects')
        .values([{ name: 'A' }, { name: 'B' }])
        .execute()
      await expect(
        db.insertInto('projects').values({ name: 'C', tenantId: 'acme' }).execute(),
      ).rejects.toThrow(/as tenant globex/)
    })
    const globex = await tenancy.run('globex', () =>
      db.selectFrom('projects').select('name').orderBy('name').execute(),
    )
    expect(globex.map((p) => p.name)).toEqual(['A', 'B', 'Lasers'])
  })

  it('reads the request tenant, and fails closed without one', async () => {
    const db = make()
    requestTenant = 'globex'
    try {
      expect(await db.selectFrom('projects').select('name').execute()).toEqual([{ name: 'Lasers' }])
    } finally {
      requestTenant = undefined
    }
    await expect(db.selectFrom('projects').selectAll().execute()).rejects.toBeInstanceOf(
      TenantRequiredError,
    )
  })
})

describe('tenancy and background jobs', () => {
  it('runs a job as the tenant that dispatched it', async () => {
    const { Container, Job, Process, runJob, stampJobContext } = await import('@forinda/kickjs')
    Container.reset()
    const db = make()
    const seen: unknown[] = []
    @Job('reports')
    class ReportJobs {
      @Process('count')
      async count() {
        seen.push(await db.selectFrom('projects').select('name').execute())
      }
    }
    void ReportJobs
    const data = tenancy.run('globex', () => stampJobContext({ kind: 'count' }))
    await runJob(Container.getInstance(), 'reports', {
      name: 'count',
      data: JSON.parse(JSON.stringify(data)),
    })
    expect(seen).toEqual([[{ name: 'Lasers' }]])
  })
})

describe("'column' tenancy: writes that could cross tenants", () => {
  const slugs = table('slugs', {
    id: serial().primaryKey(),
    tenantId: tenantKey(tenancy),
    slug: text().notNull().unique(),
    owner: text(),
  })
  const setup = () => {
    const database = new Database(':memory:')
    const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
    const target = extractSnapshot({ ...schema, slugs }, 'sqlite')
    database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
    database.exec(`INSERT INTO projects (id, tenantId, name) VALUES (1, 'acme', 'Rocket'), (2, 'globex', 'Lasers');
      INSERT INTO slugs (tenantId, slug, owner) VALUES ('globex', 'home', 'globex');`)
    return createDbClient({
      schema: { ...schema, slugs },
      tenancy,
      dialect: sqliteDialect({ database }),
    })
  }

  it("scopes UPDATE … FROM and DELETE … USING sources, and upserts can't touch another tenant's row", async () => {
    const db = setup()
    await tenancy.run('acme', async () => {
      // UPDATE … FROM: the source is filtered too, so globex's project can't drive the update.
      await db
        .updateTable('projects')
        .from('slugs')
        .set({ name: 'hijacked' })
        .whereRef('slugs.slug', '=', 'slugs.slug')
        .execute()
      const compiled = db.deleteFrom('projects').using('slugs').compile().sql
      expect(compiled).toMatch(/"slugs"\."tenantId" = \?/)
      // An upsert colliding with globex's slug leaves it alone.
      await db
        .insertInto('slugs')
        .values({ slug: 'home', owner: 'acme' })
        .onConflict((oc) => oc.column('slug').doUpdateSet({ owner: 'acme' }))
        .execute()
      await expect(
        db
          .insertInto('projects')
          .columns(['name'])
          .expression(db.selectFrom('plans').select('name'))
          .execute(),
      ).rejects.toThrow(/INSERT … SELECT/)
      await expect(
        db
          .insertInto('projects')
          .values({ name: 'x', tenantId: sql`'globex'` as never })
          .execute(),
      ).rejects.toThrow(/expression/)
    })
    const rows = await tenancy.bypass(
      async () => ({
        projects: await db.selectFrom('projects').select('name').orderBy('id').execute(),
        slugs: await db.selectFrom('slugs').select(['tenantId', 'owner']).execute(),
      }),
      { reason: 'test' },
    )
    // acme's update had no slug of its own to join, so nothing changed.
    expect(rows.projects).toEqual([{ name: 'Rocket' }, { name: 'Lasers' }])
    expect(rows.slugs).toEqual([{ tenantId: 'globex', owner: 'globex' }])
  })

  it('insertSchema leaves the tenant column optional', async () => {
    const { insertSchema } = await import('@forinda/kickjs-db/schema')
    expect(insertSchema(projects).safeParse({ name: 'x' }).success).toBe(true)
  })
})
