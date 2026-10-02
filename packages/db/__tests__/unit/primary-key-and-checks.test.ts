/**
 * Primary-key and CHECK changes in migrations (D.8): declaring them, diffing
 * them, emitting them per dialect, and reversing them.
 */
import { describe, expect, it } from 'vitest'
import {
  check,
  diff,
  emitMysql,
  emitPg,
  emitSqlite,
  extractSnapshot,
  integer,
  invertChanges,
  primaryKey,
  serial,
  table,
  varchar,
  type SchemaSnapshot,
} from '@forinda/kickjs-db'

type Dialect = SchemaSnapshot['dialect']
const snap = (schema: Record<string, unknown>, dialect: Dialect = 'postgres') =>
  extractSnapshot(schema, dialect)

const single = {
  memberships: table('memberships', {
    id: serial().primaryKey(),
    teamId: integer().notNull(),
    userId: integer().notNull(),
  }),
}
const composite = {
  memberships: table(
    'memberships',
    { id: serial(), teamId: integer().notNull(), userId: integer().notNull() },
    (t) => ({ pk: primaryKey('memberships_pk').on(t.teamId, t.userId) }),
  ),
}

describe('declaring', () => {
  it('primaryKey() marks its columns, keeps its order and name, and makes them NOT NULL', () => {
    const t = snap({
      x: table('x', { a: integer(), b: integer() }, (t) => ({
        pk: primaryKey('x_pk').on(t.b, t.a),
      })),
    }).tables.x!
    expect(t.primaryKey).toEqual({ name: 'x_pk', columns: ['b', 'a'] })
    expect(t.columns.a).toMatchObject({ primaryKey: true, nullable: false })
  })

  it('leaves a column-declared key without a table-level entry — existing snapshots are unchanged', () => {
    expect(snap(single).tables.memberships).not.toHaveProperty('primaryKey')
  })

  it('refuses a key declared twice', () => {
    expect(() =>
      table('y', { id: serial().primaryKey(), b: integer() }, (t) => ({
        pk: primaryKey().on(t.b),
      })),
    ).toThrow(/declares its primary key twice/)
  })

  it('collects check() into the snapshot', () => {
    const t = snap({
      p: table('p', { price: integer() }, () => ({ c: check('price_positive', 'price > 0') })),
    }).tables.p!
    expect(t.checks).toEqual([{ name: 'price_positive', expression: 'price > 0' }])
  })
})

describe('changing the primary key', () => {
  it('is a key change, not a column change, dropped before and added after', () => {
    const changes = diff(snap(single), snap(composite))
    expect(changes.map((c) => c.kind)).toEqual(['alterPrimaryKey', 'alterPrimaryKey'])
    expect(changes.some((c) => c.kind === 'alterColumn')).toBe(false)
  })

  it('Postgres drops the old constraint by name and adds the new one', () => {
    expect(emitPg(diff(snap(single), snap(composite)))).toBe(
      'ALTER TABLE "memberships" DROP CONSTRAINT "memberships_pkey";\n' +
        'ALTER TABLE "memberships" ADD CONSTRAINT "memberships_pk" PRIMARY KEY ("teamId", "userId");',
    )
  })

  it('MySQL swaps the key in one statement — it was a MODIFY COLUMN that touched no key', () => {
    const out = emitMysql(diff(snap(single, 'mysql'), snap(composite, 'mysql')))
    expect(out).toContain(
      'ALTER TABLE `memberships` DROP PRIMARY KEY, ADD PRIMARY KEY (`teamId`, `userId`);',
    )
    expect(out).not.toMatch(/MODIFY COLUMN/)
  })

  it('SQLite rebuilds the table with the new key', () => {
    const from = snap(single, 'sqlite')
    const to = snap(composite, 'sqlite')
    const out = emitSqlite(diff(from, to), { from, to })
    expect(out).toContain('CREATE TABLE "_kick_new_memberships"')
    expect(out).toContain('PRIMARY KEY ("teamId", "userId")')
  })

  it('a rename of the key is a change on Postgres only', () => {
    const renamed = {
      memberships: table(
        'memberships',
        { id: serial(), teamId: integer().notNull(), userId: integer().notNull() },
        (t) => ({ pk: primaryKey('memberships_team_user').on(t.teamId, t.userId) }),
      ),
    }
    expect(diff(snap(composite), snap(renamed))).toHaveLength(2)
    expect(diff(snap(composite, 'mysql'), snap(renamed, 'mysql'))).toEqual([])
  })

  it('reverses into the old key', () => {
    const forward = diff(snap(single), snap(composite))
    expect(emitPg(invertChanges(forward))).toBe(
      'ALTER TABLE "memberships" DROP CONSTRAINT "memberships_pk";\n' +
        'ALTER TABLE "memberships" ADD CONSTRAINT "memberships_pkey" PRIMARY KEY ("id");',
    )
  })

  it('adding a key column and keying on it: the column exists before the key', () => {
    const before = { t: table('t', { a: integer().primaryKey() }) }
    const after = {
      t: table('t', { a: integer().notNull(), b: integer().notNull() }, (t) => ({
        pk: primaryKey().on(t.a, t.b),
      })),
    }
    const kinds = diff(snap(before), snap(after)).map((c) => c.kind)
    expect(kinds.indexOf('addColumn')).toBeLessThan(kinds.lastIndexOf('alterPrimaryKey'))
    expect(kinds[0]).toBe('alterPrimaryKey') // the old key goes first
  })
})

describe('CHECK constraints', () => {
  const v1 = {
    p: table('p', { price: integer() }, () => ({ c: check('price_positive', 'price > 0') })),
  }
  const v2 = {
    p: table('p', { price: integer() }, () => ({
      c: check('price_positive', 'price >= 0'),
      d: check('price_cap', 'price < 1000000'),
    })),
  }

  it('adds, drops, and replaces one whose expression changed', () => {
    expect(emitPg(diff(snap(v1), snap(v2)))).toBe(
      'ALTER TABLE "p" DROP CONSTRAINT "price_positive";\n' +
        'ALTER TABLE "p" ADD CONSTRAINT "price_positive" CHECK (price >= 0);\n' +
        'ALTER TABLE "p" ADD CONSTRAINT "price_cap" CHECK (price < 1000000);',
    )
    expect(emitMysql(diff(snap(v1, 'mysql'), snap(v2, 'mysql')))).toContain(
      'ALTER TABLE `p` DROP CHECK `price_positive`;',
    )
    const from = snap(v1, 'sqlite')
    const to = snap(v2, 'sqlite')
    expect(emitSqlite(diff(from, to), { from, to })).toContain(
      'CONSTRAINT "price_cap" CHECK (price < 1000000)',
    )
  })

  it('are part of CREATE TABLE', () => {
    const out = emitPg(diff(snap({}), snap(v1)))
    expect(out).toContain('CONSTRAINT "price_positive" CHECK (price > 0)')
  })

  it('reverse', () => {
    expect(
      emitPg(invertChanges(diff(snap({ p: table('p', { price: integer() }) }), snap(v1)))),
    ).toBe('ALTER TABLE "p" DROP CONSTRAINT "price_positive";')
  })
})

it('a table with neither keeps its CREATE TABLE byte-identical', () => {
  const out = emitPg(
    diff(snap({}), snap({ u: table('u', { id: serial().primaryKey(), e: varchar(10) }) })),
  )
  expect(out).toBe(
    'CREATE TABLE "u" (\n  "id" serial NOT NULL,\n  "e" varchar(10),\n  PRIMARY KEY ("id")\n);',
  )
})
