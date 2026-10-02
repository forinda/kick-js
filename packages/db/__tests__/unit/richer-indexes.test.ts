/**
 * D.9 richer indexes: partial, expression, method, operator class, INCLUDE
 * and CONCURRENTLY — from the table DSL through snapshot, diff, emit,
 * render and generate.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  diff,
  emitMysql,
  emitPg,
  emitSqlite,
  extractSnapshot,
  generate,
  index,
  integer,
  renderSchemaSource,
  serial,
  table,
  text,
  timestamp,
  unique,
  type IndexDecl,
  type SchemaSnapshot,
} from '@forinda/kickjs-db'

const docs = table(
  'docs',
  {
    id: serial().primaryKey(),
    email: text().notNull(),
    title: text().notNull(),
    ownerId: integer().notNull(),
    deletedAt: timestamp(),
  },
  (t) => ({
    plain: index('docs_owner').on(t.ownerId),
    active: unique('docs_email_active').on(t.email).where('"deletedAt" IS NULL'),
    lower: unique('docs_email_lower').on('lower(email)'),
    trgm: index('docs_title_trgm').on(t.title).using('gin').op(t.title, 'gin_trgm_ops'),
    covering: index('docs_owner_cover').on(t.ownerId).include(t.title).concurrently(),
  }),
)

const indexes = (snap: SchemaSnapshot) =>
  Object.fromEntries(snap.tables.docs.indexes.map((i) => [i.name, i]))

describe('richer indexes', () => {
  it('records each option in the snapshot, and nothing extra for a plain index', () => {
    const ix = indexes(extractSnapshot({ docs }, 'postgres'))
    expect(ix.docs_owner).toEqual({ name: 'docs_owner', columns: ['ownerId'], unique: false })
    expect(ix.docs_email_active).toMatchObject({ unique: true, where: '"deletedAt" IS NULL' })
    expect(ix.docs_email_lower.columns).toEqual(['(lower(email))'])
    expect(ix.docs_title_trgm).toMatchObject({ using: 'gin', opclasses: { title: 'gin_trgm_ops' } })
    expect(ix.docs_owner_cover).toMatchObject({ include: ['title'], concurrently: true })
  })

  it('emits each option for Postgres', () => {
    const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
    const sql = emitPg(diff(empty, extractSnapshot({ docs }, 'postgres')))
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "docs_email_active" ON "docs" ("email") WHERE "deletedAt" IS NULL;',
    )
    expect(sql).toContain('CREATE UNIQUE INDEX "docs_email_lower" ON "docs" ((lower(email)));')
    expect(sql).toContain(
      'CREATE INDEX "docs_title_trgm" ON "docs" USING gin ("title" gin_trgm_ops);',
    )
    // On a table created in the same migration CONCURRENTLY buys nothing and
    // couldn't share its transaction, so it is left out.
    expect(sql).toContain(
      'CREATE INDEX "docs_owner_cover" ON "docs" ("ownerId") INCLUDE ("title");',
    )
  })

  it('emits partial and expression indexes for SQLite and expression / method for MySQL', () => {
    const t = table('t', { id: serial().primaryKey(), email: text() }, (c) => ({
      a: unique('t_email_live').on(c.email).where('email IS NOT NULL'),
      b: index('t_email_lower').on('lower(email)'),
    }))
    const sqliteEmpty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
    const sqliteTarget = extractSnapshot({ t }, 'sqlite')
    const sqlite = emitSqlite(diff(sqliteEmpty, sqliteTarget), {
      from: sqliteEmpty,
      to: sqliteTarget,
    })
    expect(sqlite).toContain(
      'CREATE UNIQUE INDEX "t_email_live" ON "t" ("email") WHERE email IS NOT NULL;',
    )
    expect(sqlite).toContain('CREATE INDEX "t_email_lower" ON "t" ((lower(email)));')

    const m = table('m', { id: serial().primaryKey(), email: text() }, (_c) => ({
      b: index('m_email_lower').on('lower(email)').using('hash'),
    }))
    const mysql = emitMysql(
      diff({ version: 1, dialect: 'mysql', tables: {} }, extractSnapshot({ m }, 'mysql')),
    )
    expect(mysql).toContain('CREATE INDEX `m_email_lower` ON `m` ((lower(email))) USING HASH;')
  })

  it("refuses an option the dialect can't express", () => {
    const partial = table('p', { id: serial().primaryKey(), a: text() }, (t) => ({
      i: index('p_a').on(t.a).where('a IS NOT NULL'),
    }))
    expect(() => extractSnapshot({ partial }, 'mysql')).toThrow(/uses where\(\).*mysql/)
    const gin = table('g', { id: serial().primaryKey(), a: text() }, (t) => ({
      i: index('g_a').on(t.a).using('gin'),
    }))
    expect(() => extractSnapshot({ gin }, 'sqlite')).toThrow(/uses using\(\).*sqlite/)
    expect(() => extractSnapshot({ gin }, 'mysql')).toThrow(/MySQL takes 'btree' or 'hash'/)
    expect(() =>
      table('o', { id: serial().primaryKey(), a: text() }, (t) => ({
        i: index('o_a').on(t.a).op(t.id, 'int4_ops'),
      })),
    ).toThrow(/no key id/)
  })

  it('rebuilds an index whose definition changed, and only then', () => {
    const v = (build: (t: { email: { __name: string } }) => IndexDecl) =>
      extractSnapshot(
        { t: table('t', { id: serial().primaryKey(), email: text() }, (t) => ({ i: build(t) })) },
        'postgres',
      )
    const base = v((t) => index('t_email').on(t.email))
    // Same name, new definition: dropped and created again. (Before D.9 a
    // changed index kept its name and the diff missed it.)
    const changes = diff(
      base,
      v((t) => index('t_email').on(t.email).where("email <> ''")),
    )
    expect(changes.map((c) => c.kind)).toEqual(['dropIndex', 'addIndex'])
    // How it is built, or naming the default method, is no change.
    expect(
      diff(
        base,
        v((t) => index('t_email').on(t.email).concurrently()),
      ),
    ).toEqual([])
    expect(
      diff(
        base,
        v((t) => index('t_email').on(t.email).using('btree')),
      ),
    ).toEqual([])
  })

  it('renders the options back into schema source', () => {
    const src = renderSchemaSource(extractSnapshot({ docs }, 'postgres'))
    expect(src).toContain(`unique('docs_email_active').on(t.email).where('"deletedAt" IS NULL')`)
    expect(src).toContain(`unique('docs_email_lower').on('lower(email)')`)
    expect(src).toContain(
      `index('docs_title_trgm').on(t.title).using('gin').op(t.title, 'gin_trgm_ops')`,
    )
    expect(src).toContain(`index('docs_owner_cover').on(t.ownerId).include(t.title).concurrently()`)
  })
})

describe('generate with CONCURRENTLY', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(here, '../fixtures/tmp-concurrently-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const schema = (indexes: string) => `
import { index, integer, serial, table, text } from '@forinda/kickjs-db'
export const docs = table('docs', { id: serial().primaryKey(), ownerId: integer(), title: text() }, (t) => ({${indexes}}))
`

  it('puts each concurrent index change in its own migration, outside a transaction', async () => {
    const schemaPath = path.join(dir, 'schema.ts')
    const config = {
      schemaPath,
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'postgres' as const,
    }
    let clock = Date.UTC(2026, 9, 3, 12, 0, 0)
    const now = () => new Date(clock)

    await writeFile(schemaPath, schema(''))
    await generate({ name: 'init', config, cwd: dir, now })

    clock += 60_000
    // A new file: the loader caches a module by path.
    const nextPath = path.join(dir, 'schema-next.ts')
    await writeFile(
      nextPath,
      schema(`
  owner: index('docs_owner').on(t.ownerId).concurrently(),
  title: index('docs_title').on(t.title).concurrently(),`).replace(
        'title: text() }',
        'title: text(), body: text() }',
      ),
    )
    const next = { ...config, schemaPath: nextPath }
    const r = await generate({ name: 'indexes', config: next, cwd: dir, now })
    expect(r.changeCount).toBe(3)

    const ids = (await readdir(config.migrationsDir))
      .filter((e) => e !== '_journal.json')
      .toSorted()
    expect(ids).toEqual([
      '20261003_120000_init',
      '20261003_120100_indexes',
      '20261003_120101_indexes_concurrently_1',
      '20261003_120102_indexes_concurrently_2',
    ])
    const read = (id: string, f: string) => readFile(path.join(config.migrationsDir, id, f), 'utf8')

    // The ordinary change keeps its transaction; the snapshot it records has
    // neither index yet.
    expect(await read(ids[1], 'up.sql')).toContain('ADD COLUMN "body"')
    expect(JSON.parse(await read(ids[1], 'meta.json')).transaction).toBeUndefined()
    expect(JSON.parse(await read(ids[1], 'snapshot.json')).tables.docs.indexes).toEqual([])

    for (const [n, name] of [
      [2, 'docs_owner'],
      [3, 'docs_title'],
    ] as const) {
      const up = await read(ids[n], 'up.sql')
      expect(up).toContain(`CREATE INDEX CONCURRENTLY "${name}"`)
      expect(up.match(/;/g)).toHaveLength(1)
      expect(await read(ids[n], 'down.sql')).toContain(`DROP INDEX CONCURRENTLY "${name}"`)
      expect(JSON.parse(await read(ids[n], 'meta.json'))).toMatchObject({
        transaction: false,
        previousId: ids[n - 1],
      })
    }
    const last = JSON.parse(await read(ids[3], 'snapshot.json'))
    expect(last.tables.docs.indexes.map((i: { name: string }) => i.name).toSorted()).toEqual([
      'docs_owner',
      'docs_title',
    ])

    // Nothing left to generate.
    expect((await generate({ name: 'again', config: next, cwd: dir, now })).status).toBe(
      'no-changes',
    )
  })
})
