import { describe, expectTypeOf, it } from 'vitest'
import type { Kysely, KyselyTypeError } from 'kysely'
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
// `_narrowed*` helpers are declared but never invoked — we only
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

// Never invoked — `ReturnType<typeof ...>` reads through to the
// narrowed shape without executing the calls.
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

// `ReadonlyKysely` keeps `insertInto` / `updateTable` / `deleteFrom` /
// `mergeInto` as poisoned methods — they're typed to return a
// `KyselyTypeError<'not allowed with a read-only Kysely instance.'>`
// sentinel, so any call site fails to typecheck even though the
// property name remains visible in IDE autocomplete. Asserting on
// the return type (rather than the property's presence) reflects
// the real enforcement.
type WriteMethodReturn<M extends 'insertInto' | 'updateTable' | 'deleteFrom' | 'mergeInto'> =
  ReturnType<ReadonlyKysely<DB>[M]>
type PoisonedWriteSentinel = KyselyTypeError<'not allowed with a read-only Kysely instance.'>

describe('Kysely $pickTables / $omitTables', () => {
  it('$pickTables narrows the table set to the picked keys', () => {
    expectTypeOf<PickedFull>().toExtend<Kysely<Pick<DB, 'users'>>>()
  })

  it('$omitTables removes the named tables from the table set', () => {
    expectTypeOf<OmittedFull>().toExtend<Kysely<Omit<DB, 'posts'>>>()
  })
})

describe('ReadonlyKysely', () => {
  it('exposes selectFrom on the narrowed surface', () => {
    expectTypeOf<ReadonlyKysely<DB>>().toHaveProperty('selectFrom')
  })

  it('poisons write entrypoints (insertInto / updateTable / deleteFrom / mergeInto)', () => {
    // Each write method is typed to return a `KyselyTypeError` sentinel,
    // so call sites like `ro.insertInto('users')` are compile-time
    // rejected even though the property name remains visible.
    expectTypeOf<WriteMethodReturn<'insertInto'>>().toEqualTypeOf<PoisonedWriteSentinel>()
    expectTypeOf<WriteMethodReturn<'updateTable'>>().toEqualTypeOf<PoisonedWriteSentinel>()
    expectTypeOf<WriteMethodReturn<'deleteFrom'>>().toEqualTypeOf<PoisonedWriteSentinel>()
    expectTypeOf<WriteMethodReturn<'mergeInto'>>().toEqualTypeOf<PoisonedWriteSentinel>()
  })

  it('$pickTables narrows to ReadonlyKysely (not a full Kysely)', () => {
    expectTypeOf<PickedRo>().toExtend<ReadonlyKysely<Pick<DB, 'users'>>>()
  })

  it('$omitTables narrows to ReadonlyKysely (not a full Kysely)', () => {
    expectTypeOf<OmittedRo>().toExtend<ReadonlyKysely<Omit<DB, 'posts'>>>()
  })
})
