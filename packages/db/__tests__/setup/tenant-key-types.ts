/**
 * The same tenancy round trip for a tenant column of another type — uuid, a
 * ULID in varchar(26), integer, bigint — on any dialect, 'column' or 'rls'. The
 * tenant id is always a string (`run('1', …)`); the row holds the column's
 * own type.
 */
import { expect } from 'vitest'
import {
  bigint,
  integer,
  relations,
  serial,
  table,
  tenantKey,
  text,
  uuid,
  varchar,
  type ColumnBuilder,
  type KickDbClient,
  type Tenancy,
} from '@forinda/kickjs-db'

export interface TenantKeyCase {
  name: string
  column: () => ColumnBuilder<any>
  /** Two tenants' ids, as `run()` takes them. */
  a: string
  b: string
  /** The same ids as the row holds them. */
  nativeA: unknown
  nativeB: unknown
}

export const tenantKeyCases: TenantKeyCase[] = [
  {
    name: 'uuid()',
    column: uuid,
    a: '0b8e2f9a-3c1d-4e5f-8a7b-1c2d3e4f5a6b',
    b: '7f6e5d4c-3b2a-4190-8877-665544332211',
    nativeA: '0b8e2f9a-3c1d-4e5f-8a7b-1c2d3e4f5a6b',
    nativeB: '7f6e5d4c-3b2a-4190-8877-665544332211',
  },
  {
    name: 'varchar(26) ULID',
    column: () => varchar(26),
    a: '01HZX3J8K9M2N4P6Q8R0S2T4V6',
    b: '01HZX3J8K9M2N4P6Q8R0S2T4V7',
    nativeA: '01HZX3J8K9M2N4P6Q8R0S2T4V6',
    nativeB: '01HZX3J8K9M2N4P6Q8R0S2T4V7',
  },
  { name: 'integer()', column: integer, a: '1', b: '2', nativeA: 1, nativeB: 2 },
  {
    name: "bigint({ mode: 'bigint' })",
    column: () => bigint({ mode: 'bigint' }),
    a: '1',
    b: '2',
    nativeA: 1n,
    nativeB: 2n,
  },
]

/** How the tenant column is named: its key, and the database's name for it. */
export interface TenantKeyNaming {
  name: string
  key: string
  dbName: string
  colName?: string
  casing?: 'snake_case'
}

export const tenantKeyNamings: TenantKeyNaming[] = [
  { name: 'camelCase key', key: 'workspaceId', dbName: 'workspaceId' },
  { name: 'snake_case key', key: 'organization_id', dbName: 'organization_id' },
  {
    name: "camelCase key, casing: 'snake_case'",
    key: 'organizationId',
    dbName: 'organization_id',
    casing: 'snake_case',
  },
  { name: '.colName() override', key: 'orgId', dbName: 'org_id', colName: 'org_id' },
]

export function tenantKeySchema(
  tenancy: Tenancy,
  c: TenantKeyCase,
  naming: TenantKeyNaming = { name: 'tenantId', key: 'tenantId', dbName: 'tenantId' },
) {
  const column = () => {
    const col = c.column()
    return tenantKey(tenancy, naming.colName ? col.colName(naming.colName) : col)
  }
  const projects = table('projects', {
    id: serial().primaryKey(),
    [naming.key]: column(),
    name: text().notNull(),
  })
  const tasks = table('tasks', {
    id: serial().primaryKey(),
    [naming.key]: column(),
    projectId: integer().notNull(),
    title: text().notNull(),
  })
  const projectRelations = relations(projects, ({ many }) => ({ tasks: many(tasks) }))
  const taskRelations = relations(tasks, ({ one }) => ({
    project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  }))
  return { projects, tasks, projectRelations, taskRelations }
}

export async function tenantKeyFlow(
  db: KickDbClient<any>,
  tenancy: Tenancy,
  c: TenantKeyCase,
  /** The tenant column's key. */
  k = 'tenantId',
): Promise<void> {
  const all = <T>(fn: () => Promise<T>) => tenancy.bypass(fn, { reason: 'test' })

  // Insert: the tenant is filled in from run().
  const rocket = await tenancy.run(c.a, () =>
    db
      .insertInto('projects')
      .values({ name: 'Rocket' })
      .returning(['id', k])
      .executeTakeFirstOrThrow(),
  )
  expect(rocket[k]).toEqual(c.nativeA)
  const lasers = await tenancy.run(c.b, () =>
    db.insertInto('projects').values({ name: 'Lasers' }).returning('id').executeTakeFirstOrThrow(),
  )
  await tenancy.run(c.a, () =>
    db.insertInto('tasks').values({ projectId: rocket.id, title: 'fuel' }).execute(),
  )
  await tenancy.run(c.b, () =>
    db
      .insertInto('tasks')
      .values([
        { projectId: lasers.id, title: 'aim' },
        { projectId: rocket.id, title: 'planted in a' },
      ])
      .execute(),
  )

  await tenancy.run(c.a, async () => {
    // Select, filtered to the tenant.
    expect(await db.selectFrom('projects').select(['name', k]).execute()).toEqual([
      { name: 'Rocket', [k]: c.nativeA },
    ])
    // A join: the joined table is filtered too.
    expect(
      await db
        .selectFrom('projects')
        .leftJoin('tasks', 'tasks.projectId', 'projects.id')
        .select(['projects.name', 'tasks.title'])
        .execute(),
    ).toEqual([{ name: 'Rocket', title: 'fuel' }])
    // Every level of db.query.
    const found = await db.query.projects.findMany({ with: { tasks: true } })
    expect(found.map((p: any) => [p.name, p.tasks.map((t: any) => t.title)])).toEqual([
      ['Rocket', ['fuel']],
    ])
    // Update and delete touch only the tenant's rows.
    await db.updateTable('tasks').set({ title: 'refuel' }).execute()
    await db.deleteFrom('projects').where('name', '=', 'Lasers').execute()
    // A row for another tenant is refused — as a string or the column's type.
    for (const other of [c.b, c.nativeB]) {
      await expect(
        db
          .insertInto('projects')
          .values({ name: 'x', [k]: other })
          .execute(),
      ).rejects.toThrow()
    }
    // The tenant given explicitly, in the column's own type, is accepted.
    await db
      .insertInto('projects')
      .values({ name: 'Explicit', [k]: c.nativeA })
      .execute()
  })

  expect(
    await all(() => db.selectFrom('tasks').select(['title', k]).orderBy('id').execute()),
  ).toEqual([
    { title: 'refuel', [k]: c.nativeA },
    { title: 'aim', [k]: c.nativeB },
    { title: 'planted in a', [k]: c.nativeB },
  ])
  expect(
    await all(() => db.selectFrom('projects').select(['name', k]).orderBy('id').execute()),
  ).toEqual([
    { name: 'Rocket', [k]: c.nativeA },
    { name: 'Lasers', [k]: c.nativeB },
    { name: 'Explicit', [k]: c.nativeA },
  ])
}
