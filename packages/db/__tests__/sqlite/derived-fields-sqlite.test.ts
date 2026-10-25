/**
 * The derived-field forms from the Table Forms guide, on SQLite: a getter on a
 * base-class table, a result extension, and a generated column over
 * mixed-case keys.
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  checkDrift,
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  introspectSqlite,
  serial,
  table,
  TableBase,
  text,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const columns = () => ({ id: serial().primaryKey(), firstName: text().notNull(), lastName: text() })

function open<S extends Record<string, unknown>>(schema: S) {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return { database, target, db: createDbClient({ schema, dialect: sqliteDialect({ database }) }) }
}

const ADA = { firstName: 'Ada', lastName: 'Lovelace' }
const CHER = { firstName: 'Cher', lastName: null }

describe('derived fields on SQLite', () => {
  it('a getter, after Person.from(row)', async () => {
    class Person extends TableBase('people', columns()) {
      get fullName() {
        return [this.firstName, this.lastName].filter(Boolean).join(' ')
      }
    }
    const { db } = open({ Person })
    await db.insertInto('people').values([ADA, CHER]).execute()
    const rows = await db.selectFrom('people').selectAll().orderBy('id').execute()
    expect(rows[0]).not.toHaveProperty('fullName')
    const people = rows.map((r) => Person.from(r))
    expect(people.map((p) => p.fullName)).toEqual(['Ada Lovelace', 'Cher'])
  })

  it('a result extension, on every select', async () => {
    const people = table('people', columns())
    const { db: base } = open({ people })
    const db = base.$extends({
      result: {
        people: {
          fullName: {
            needs: { firstName: true, lastName: true },
            compute: (r) => [r.firstName, r.lastName].filter(Boolean).join(' '),
          },
        },
      },
    })
    await db.insertInto('people').values([ADA, CHER]).execute()
    const narrow = await db.selectFrom('people').select(['id']).orderBy('id').execute()
    expectTypeOf(narrow[0]!.fullName).toEqualTypeOf<string>()
    expect(narrow.map((r) => r.fullName)).toEqual(['Ada Lovelace', 'Cher'])
    const viaQuery = await db.query.people.findMany()
    expect(viaQuery.map((r) => r.fullName)).toEqual(['Ada Lovelace', 'Cher'])
  })

  it('a generated column over mixed-case keys: computes, follows updates, filters', async () => {
    const people = table('people', {
      ...columns(),
      fullName: text().generatedAlwaysAs(`"firstName" || coalesce(' ' || "lastName", '')`),
    })
    const { db, database, target } = open({ people })
    await db.insertInto('people').values([ADA, CHER]).execute()
    const all = await db.selectFrom('people').select(['fullName']).orderBy('id').execute()
    expect(all.map((r) => r.fullName)).toEqual(['Ada Lovelace', 'Cher'])

    await db.updateTable('people').set({ lastName: 'King' }).where('id', '=', 1).execute()
    const found = await db
      .selectFrom('people')
      .select(['fullName'])
      .where('fullName', 'like', 'Ada%')
      .execute()
    expect(found).toEqual([{ fullName: 'Ada King' }])
    await expect(checkDrift(introspectSqlite(database), target, 'error')).resolves.toBeUndefined()
  })
})
