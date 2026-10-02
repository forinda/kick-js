/**
 * D.8 on SQLite: a key and CHECK change rebuild the table through the
 * migration adapter, and a rebuild that would leave a dangling foreign key is
 * rolled back by `foreign_key_check`.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  check,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  primaryKey,
  serial,
  table,
} from '@forinda/kickjs-db'
import { sqliteAdapter } from '@forinda/kickjs-db/sqlite'

const snap = (s: Record<string, unknown>) => extractSnapshot(s, 'sqlite')
const migrate = (from: Record<string, unknown>, to: Record<string, unknown>) => {
  const a = snap(from)
  const b = snap(to)
  return emitSqlite(diff(a, b), { from: a, to: b })
}

describe('primary-key and CHECK migrations (sqlite)', () => {
  it('rebuilds with the new key and CHECK, keeping rows', async () => {
    const database = new Database(':memory:')
    const adapter = sqliteAdapter({ database })
    const v1 = {
      m: table('m', { id: serial().primaryKey(), a: integer().notNull(), b: integer().notNull() }),
    }
    const v2 = {
      m: table('m', { id: integer(), a: integer().notNull(), b: integer().notNull() }, (t) => ({
        pk: primaryKey().on(t.a, t.b),
        c: check('a_positive', 'a > 0'),
      })),
    }
    await adapter.applySqlInTx(migrate({}, v1))
    database.exec('INSERT INTO m (a, b) VALUES (1, 1), (1, 2)')
    await adapter.applySqlInTx(migrate(v1, v2))

    const pk = (database.prepare('PRAGMA table_info(m)').all() as { name: string; pk: number }[])
      .filter((c) => c.pk > 0)
      .toSorted((x, y) => x.pk - y.pk)
      .map((c) => c.name)
    expect(pk).toEqual(['a', 'b'])
    expect((database.prepare('SELECT count(*) AS n FROM m').get() as { n: number }).n).toBe(2)
    expect(() => database.exec('INSERT INTO m (a, b) VALUES (1, 1)')).toThrow(/UNIQUE/)
    expect(() => database.exec('INSERT INTO m (a, b) VALUES (0, 5)')).toThrow(/CHECK/)
  })

  it('rolls a rebuild back when it would leave a row pointing at a missing parent', async () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    const adapter = sqliteAdapter({ database })
    const parents = table('parents', { id: integer().primaryKey() })
    const before = {
      parents,
      kids: table('kids', {
        id: integer().primaryKey(),
        parentId: integer().references(() => parents.id),
      }),
    }
    const after = {
      parents,
      kids: table(
        'kids',
        { id: integer().primaryKey(), parentId: integer().references(() => parents.id) },
        () => ({ c: check('id_positive', 'id > 0') }),
      ),
    }
    await adapter.applySqlInTx(migrate({}, before))
    // An orphan that slipped in while enforcement was off — and a rebuild run
    // with it off, as SQLite's own table-rebuild procedure does.
    database.pragma('foreign_keys = OFF')
    database.exec('INSERT INTO kids (id, parentId) VALUES (1, 42)')

    await expect(adapter.applySqlInTx(migrate(before, after))).rejects.toThrow(
      /foreign key points at a missing row \(kids → parents\)/,
    )

    // With enforcement on, SQLite refuses the row copy itself — rolled back too.
    database.pragma('foreign_keys = ON')
    await expect(adapter.applySqlInTx(migrate(before, after))).rejects.toThrow(/FOREIGN KEY/)
    // Rolled back: still the old table, without the CHECK.
    const ddl = (
      database.prepare("SELECT sql FROM sqlite_master WHERE name = 'kids'").get() as { sql: string }
    ).sql
    expect(ddl).not.toContain('id_positive')
  })

  it('checks only rows touching the rebuilt table — an old orphan elsewhere does not block it', async () => {
    const database = new Database(':memory:')
    const adapter = sqliteAdapter({ database })
    const parents = table('parents', { id: integer().primaryKey() })
    const others = table('others', {
      id: integer().primaryKey(),
      parentId: integer().references(() => parents.id),
    })
    const before = {
      parents,
      others,
      prices: table('prices', { id: integer().primaryKey(), n: integer() }),
    }
    const after = {
      parents,
      others,
      prices: table('prices', { id: integer().primaryKey(), n: integer() }, () => ({
        c: check('n_positive', 'n > 0'),
      })),
    }
    await adapter.applySqlInTx(migrate({}, before))
    database.pragma('foreign_keys = OFF')
    database.exec('INSERT INTO others (id, parentId) VALUES (1, 99)') // unrelated orphan
    await adapter.applySqlInTx(migrate(before, after)) // rebuilds prices only — commits
    const ddl = (
      database.prepare("SELECT sql FROM sqlite_master WHERE name = 'prices'").get() as {
        sql: string
      }
    ).sql
    expect(ddl).toContain('n_positive')
  })

  it('catches a child whose rebuilt parent no longer has its row', async () => {
    const database = new Database(':memory:')
    const adapter = sqliteAdapter({ database })
    const v1parents = table('parents', { id: integer().primaryKey(), code: integer() })
    const kids = table('kids', {
      id: integer().primaryKey(),
      parentId: integer().references(() => v1parents.id),
    })
    const v2parents = table('parents', { id: integer().primaryKey(), code: integer() }, () => ({
      c: check('code_positive', 'code > 0'),
    }))
    await adapter.applySqlInTx(migrate({}, { parents: v1parents, kids }))
    database.pragma('foreign_keys = OFF')
    database.exec('INSERT INTO kids (id, parentId) VALUES (1, 7)') // parent 7 doesn't exist
    await expect(
      adapter.applySqlInTx(migrate({ parents: v1parents, kids }, { parents: v2parents, kids })),
    ).rejects.toThrow(/kids → parents/)
  })
})
