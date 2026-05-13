import { describe, expectTypeOf, it } from 'vitest'
import type { Kysely } from 'kysely'
import {
  table,
  serial,
  varchar,
  text,
  integer,
  type ReadonlyKysely,
  type SchemaToTypes,
} from '@forinda/kickjs-db'

// M5.A.3 — type-only coverage for Kysely 0.29's narrowing helpers.
// Asserts the `ReadonlyKysely` re-export is reachable on the bare
// `@forinda/kickjs-db` import path and that `$pickTables` / `$omitTables`
// narrow the table set as expected.
//
// `_narrowed*` functions are declared but never invoked — we only
// reach for their `ReturnType` at compile time. This avoids the
// runtime-null trap (where `kdb.$pickTables()` would throw) and the
// oxc parser limitation on `Kysely<DB>['$pickTables']<'users'>`
// indexed-generic-call type expressions.

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
  name: varchar(120),
})

const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer().notNull(),
  body: text().notNull(),
})

type DB = SchemaToTypes<{ users: typeof users; posts: typeof posts }>

declare const kdb: Kysely<DB>
declare const ro: ReadonlyKysely<DB>

// Never invoked — used only via ReturnType<typeof ...>.
function _narrowedPick() {
  return kdb.$pickTables<'users'>()
}
function _narrowedOmit() {
  return kdb.$omitTables<'posts'>()
}
function _narrowedPickRo() {
  return ro.$pickTables<'users'>()
}
function _narrowedOmitRo() {
  return ro.$omitTables<'posts'>()
}

type PickedFull = ReturnType<typeof _narrowedPick>
type OmittedFull = ReturnType<typeof _narrowedOmit>
type PickedRo = ReturnType<typeof _narrowedPickRo>
type OmittedRo = ReturnType<typeof _narrowedOmitRo>

describe('Kysely $pickTables / $omitTables', () => {
  it('$pickTables narrows the table set to the picked keys', () => {
    expectTypeOf<PickedFull>().toMatchTypeOf<Kysely<Pick<DB, 'users'>>>()
  })

  it('$omitTables removes the named tables from the table set', () => {
    expectTypeOf<OmittedFull>().toMatchTypeOf<Kysely<Omit<DB, 'posts'>>>()
  })
})

describe('ReadonlyKysely', () => {
  it('exposes selectFrom on the narrowed surface', () => {
    expectTypeOf<ReadonlyKysely<DB>>().toHaveProperty('selectFrom')
  })

  it('does not expose write entrypoints', () => {
    // `ReadonlyKysely` keeps only `case`, `destroy`, `dynamic`, `fn`,
    // `introspection`, `isTransaction` from the full `Kysely` shape —
    // `insertInto` / `updateTable` / `deleteFrom` / `mergeInto` are gone.
    expectTypeOf<ReadonlyKysely<DB>>().not.toHaveProperty('insertInto')
    expectTypeOf<ReadonlyKysely<DB>>().not.toHaveProperty('updateTable')
    expectTypeOf<ReadonlyKysely<DB>>().not.toHaveProperty('deleteFrom')
    expectTypeOf<ReadonlyKysely<DB>>().not.toHaveProperty('mergeInto')
  })

  it('$pickTables narrows to ReadonlyKysely (not a full Kysely)', () => {
    expectTypeOf<PickedRo>().toMatchTypeOf<ReadonlyKysely<Pick<DB, 'users'>>>()
  })

  it('$omitTables narrows to ReadonlyKysely (not a full Kysely)', () => {
    expectTypeOf<OmittedRo>().toMatchTypeOf<ReadonlyKysely<Omit<DB, 'posts'>>>()
  })
})
