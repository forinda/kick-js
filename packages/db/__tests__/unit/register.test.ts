import { describe, expectTypeOf, it } from 'vitest'
import type { Generated } from 'kysely'
import { table, serial, varchar, type KickDbClient, type SchemaToKysely } from '@forinda/kickjs-db'

// ── Adopter-side schema declaration ─────────────────────────────────────
const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull(),
})

const _appSchema = { users }
type AppDB = SchemaToKysely<typeof _appSchema>

// `declare module` lands once per TS project — it's a global augmentation,
// not file-local. This single test file owns the augmentation; if other
// tests need different shapes they should redeclare here.
declare module '@forinda/kickjs-db' {
  interface Register {
    db: KickDbClient<AppDB>
  }
}

describe('Register augmentation', () => {
  it('KickDbClient with no explicit generic exposes the registered DB', () => {
    // Type-only: pull DB out of the inferred default and assert it widened
    // to the schema-derived shape.
    type DefaultDb = KickDbClient extends KickDbClient<infer X> ? X : never
    expectTypeOf<DefaultDb>().toEqualTypeOf<AppDB>()
    expectTypeOf<DefaultDb>().toEqualTypeOf<{
      users: { id: Generated<number>; email: string }
    }>()
  })

  it('explicit DB generic overrides Register', () => {
    interface ExplicitDB {
      readonly things: { id: number; payload: string }
    }
    type Explicit = KickDbClient<ExplicitDB> extends KickDbClient<infer X> ? X : never
    expectTypeOf<Explicit>().toEqualTypeOf<ExplicitDB>()
  })
})
