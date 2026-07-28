import { describe, it, expect } from 'vitest'
import { table, serial, varchar, integer, index, extractSnapshot, diff } from '@forinda/kickjs-db'
import { pgSchema } from '@forinda/kickjs-db/pg'
import { invertChanges } from '../../src/diff/invert'
import { emitPg } from '../../src/emit/pg'
import type { SchemaSnapshot } from '../../src/snapshot/types'

const empty: SchemaSnapshot = { version: 1, dialect: 'postgres', tables: {} }

describe('pgSchema()', () => {
  describe('declaration', () => {
    it('keys the snapshot by qualified name and records the schema', () => {
      const billing = pgSchema('billing')
      const invoices = billing.table('invoices', { id: serial().primaryKey() })

      const snap = extractSnapshot({ invoices }, 'postgres')

      expect(Object.keys(snap.tables)).toEqual(['billing.invoices'])
      expect(snap.tables['billing.invoices'].name).toBe('invoices')
      expect(snap.tables['billing.invoices'].schema).toBe('billing')
      expect(snap.schemas).toEqual(['billing'])
    })

    it('leaves unqualified tables byte-identical to before schemas existed', () => {
      const users = table('users', { id: serial().primaryKey() })
      const snap = extractSnapshot({ users }, 'postgres')

      expect(Object.keys(snap.tables)).toEqual(['users'])
      // No `schema` key at all, and no `schemas` array — an added-but-undefined
      // field would change the serialized JSON and break migration hashes.
      expect('schema' in snap.tables.users).toBe(false)
      expect('schemas' in snap).toBe(false)
    })

    it("collapses pgSchema('public') to no schema", () => {
      // Otherwise `public.users` and `users` would be different snapshot keys
      // for the same physical table, and the diff would emit DROP + CREATE.
      const pub = pgSchema('public')
      const users = pub.table('users', { id: serial().primaryKey() })
      const snap = extractSnapshot({ users }, 'postgres')

      expect(Object.keys(snap.tables)).toEqual(['users'])
      expect('schema' in snap.tables.users).toBe(false)
      expect(snap.schemas).toBeUndefined()
    })

    it('lets two schemas hold same-named tables without collision', () => {
      const billing = pgSchema('billing')
      const audit = pgSchema('audit')
      const a = billing.table('events', { id: serial().primaryKey() })
      const b = audit.table('events', { id: serial().primaryKey() })

      const snap = extractSnapshot({ a, b }, 'postgres')

      expect(Object.keys(snap.tables).toSorted()).toEqual(['audit.events', 'billing.events'])
      expect(snap.schemas).toEqual(['audit', 'billing'])
    })

    it('sorts the schema list so the snapshot hash is order-independent', () => {
      const z = pgSchema('zeta').table('t', { id: serial().primaryKey() })
      const a = pgSchema('alpha').table('t', { id: serial().primaryKey() })
      expect(extractSnapshot({ z, a }, 'postgres').schemas).toEqual(['alpha', 'zeta'])
    })

    it('rejects a schema name that is not a bare identifier', () => {
      expect(() => pgSchema('bad-name')).toThrow(/invalid schema name/)
      expect(() => pgSchema('drop";--')).toThrow(/invalid schema name/)
      expect(() => pgSchema('')).toThrow(/invalid schema name/)
    })
  })

  describe('dialect guard', () => {
    it.each(['mysql', 'sqlite'] as const)('rejects a declared schema on %s', (dialect) => {
      const invoices = pgSchema('billing').table('invoices', { id: serial().primaryKey() })
      expect(() => extractSnapshot({ invoices }, dialect)).toThrow(/PostgreSQL-only/)
    })

    it('leaves unqualified tables working on every dialect', () => {
      const users = table('users', { id: serial().primaryKey() })
      for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
        expect(() => extractSnapshot({ users }, dialect)).not.toThrow()
      }
    })
  })

  describe('DDL', () => {
    it('creates the schema before the tables inside it', () => {
      const invoices = pgSchema('billing').table('invoices', { id: serial().primaryKey() })
      const next = extractSnapshot({ invoices }, 'postgres')
      const changes = diff(empty, next)

      expect(changes[0]).toEqual({ kind: 'createSchema', schema: 'billing' })
      expect(changes[1].kind).toBe('createTable')

      const sql = emitPg(changes)
      expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "billing";')
      expect(sql).toContain('CREATE TABLE "billing"."invoices"')
      // The schema statement must precede the table that needs it.
      expect(sql.indexOf('CREATE SCHEMA')).toBeLessThan(sql.indexOf('CREATE TABLE'))
    })

    it('does not re-create a schema that already existed', () => {
      const invoices = pgSchema('billing').table('invoices', { id: serial().primaryKey() })
      const prev = extractSnapshot({ invoices }, 'postgres')
      const withMore = pgSchema('billing').table('notes', { id: serial().primaryKey() })
      const next = extractSnapshot({ invoices, withMore }, 'postgres')

      const changes = diff(prev, next)
      expect(changes.some((c) => c.kind === 'createSchema')).toBe(false)
    })

    it('qualifies DROP TABLE', () => {
      const invoices = pgSchema('billing').table('invoices', { id: serial().primaryKey() })
      const prev = extractSnapshot({ invoices }, 'postgres')
      const sql = emitPg(diff(prev, empty))
      expect(sql).toContain('DROP TABLE "billing"."invoices";')
    })

    it('qualifies a foreign key that targets a schema-qualified table', () => {
      const billing = pgSchema('billing')
      const invoices = billing.table('invoices', { id: serial().primaryKey() })
      const lines = table('lines', {
        id: serial().primaryKey(),
        invoiceId: integer().references(() => invoices.id),
      })

      const sql = emitPg(diff(empty, extractSnapshot({ invoices, lines }, 'postgres')))
      expect(sql).toContain('REFERENCES "billing"."invoices" ("id")')
    })

    it('qualifies DROP INDEX with the table schema', () => {
      // CREATE INDEX takes its schema from the qualified table it targets, but
      // DROP INDEX resolves the index name through search_path — a bare name
      // would miss, or hit a same-named index in public.
      const withIdx = pgSchema('billing').table(
        'invoices',
        { id: serial().primaryKey(), ref: varchar(32) },
        (t) => ({ refIdx: index('invoices_ref_idx').on(t.ref) }),
      )
      const withoutIdx = pgSchema('billing').table('invoices', {
        id: serial().primaryKey(),
        ref: varchar(32),
      })

      const prev = extractSnapshot({ withIdx }, 'postgres')
      const next = extractSnapshot({ withoutIdx }, 'postgres')
      const sql = emitPg(diff(prev, next))

      expect(sql).toContain('DROP INDEX "billing"."invoices_ref_idx";')
    })

    it('creates an index on the qualified table', () => {
      const withIdx = pgSchema('billing').table(
        'invoices',
        { id: serial().primaryKey(), ref: varchar(32) },
        (t) => ({ refIdx: index('invoices_ref_idx').on(t.ref) }),
      )
      const sql = emitPg(diff(empty, extractSnapshot({ withIdx }, 'postgres')))
      expect(sql).toContain('ON "billing"."invoices"')
    })

    it('qualifies ALTER TABLE for column changes', () => {
      const before = pgSchema('billing').table('invoices', { id: serial().primaryKey() })
      const after = pgSchema('billing').table('invoices', {
        id: serial().primaryKey(),
        note: varchar(64),
      })
      const sql = emitPg(
        diff(extractSnapshot({ before }, 'postgres'), extractSnapshot({ after }, 'postgres')),
      )
      expect(sql).toContain('ALTER TABLE "billing"."invoices" ADD COLUMN')
    })
  })

  describe('inversion', () => {
    it('never drops a schema in the down migration', () => {
      // A schema can hold objects this app never declared, so an inferred
      // DROP SCHEMA could destroy data the diff never saw.
      const invoices = pgSchema('billing').table('invoices', { id: serial().primaryKey() })
      const forward = diff(empty, extractSnapshot({ invoices }, 'postgres'))

      const down = invertChanges(forward)
      expect(down.some((c) => c.kind === 'createSchema')).toBe(false)
      expect(down.map((c) => c.kind)).toContain('dropTable')
      expect(emitPg(down)).not.toContain('DROP SCHEMA')
    })

    it('still prunes redundant teardown for a qualified table', () => {
      // dropTable carries a bare name + schema while dropIndex carries the
      // qualified key; comparing them raw would stop the prune from firing.
      const withIdx = pgSchema('billing').table(
        'invoices',
        { id: serial().primaryKey(), ref: varchar(32) },
        (t) => ({ refIdx: index('invoices_ref_idx').on(t.ref) }),
      )
      const forward = diff(empty, extractSnapshot({ withIdx }, 'postgres'))
      const down = invertChanges(forward)

      expect(down.some((c) => c.kind === 'dropIndex')).toBe(false)
      expect(down.some((c) => c.kind === 'dropTable')).toBe(true)
    })
  })

  describe('end to end', () => {
    it('qualifies every identifier in the up and down SQL', () => {
      const billing = pgSchema('billing')
      const invoices = billing.table(
        'invoices',
        { id: serial().primaryKey(), ref: varchar(32) },
        (t) => ({ refIdx: index('invoices_ref_idx').on(t.ref) }),
      )
      const lines = table('lines', {
        id: serial().primaryKey(),
        invoiceId: integer().references(() => invoices.id),
      })

      const next = extractSnapshot({ invoices, lines }, 'postgres')
      const forward = diff(empty, next)
      const up = emitPg(forward)
      const down = emitPg(invertChanges(forward))

      expect(up).toContain('CREATE SCHEMA IF NOT EXISTS "billing";')
      expect(up).toContain('CREATE TABLE "billing"."invoices"')
      expect(up).toContain('REFERENCES "billing"."invoices" ("id")')
      // `lines` is unqualified and must stay that way.
      expect(up).toContain('CREATE TABLE "lines"')

      expect(down).toContain('DROP TABLE "billing"."invoices";')
      expect(down).toContain('DROP TABLE "lines";')
      expect(down).not.toContain('DROP SCHEMA')

      // Nothing may reference the qualified table by its bare name — that
      // would resolve through search_path to the wrong object.
      expect(up).not.toMatch(/(CREATE|ALTER|DROP) TABLE "invoices"/)
      expect(down).not.toMatch(/(CREATE|ALTER|DROP) TABLE "invoices"/)
    })
  })
})
