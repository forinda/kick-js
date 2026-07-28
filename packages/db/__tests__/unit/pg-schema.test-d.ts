// Type-level companion to pg-schema.test.ts. Lives in a `.test-d.ts` file
// because vitest only enforces expectTypeOf assertions under `--typecheck`,
// whose include list is `**/*.test-d.ts` — and because the package tsconfig
// only includes `src`, so `tsc --noEmit` would never see these.
//
// Run: vitest run --typecheck --typecheck.ignoreSourceErrors \
//        __tests__/unit/pg-schema.test-d.ts
import { describe, it, expectTypeOf } from 'vitest'
import type { Generated } from 'kysely'

import { serial, varchar, table } from '../../src/index'
import type { SchemaToTypes } from '../../src/index'
import { pgSchema } from '../../src/pg'

describe('pgSchema() row-type keys (type-level)', () => {
  it('keys a schema-qualified table by "<schema>.<table>"', () => {
    const billing = pgSchema('billing')
    const invoices = billing.table('invoices', {
      id: serial().primaryKey(),
      ref: varchar(32).notNull(),
    })
    const schema = { invoices }
    type DB = SchemaToTypes<typeof schema>

    // Kysely reads a dotted table name as schema-qualified, so this key is
    // what makes `db.selectFrom('billing.invoices')` resolve without a
    // withSchema() call.
    expectTypeOf<keyof DB>().toEqualTypeOf<'billing.invoices'>()
    expectTypeOf<DB['billing.invoices']>().toEqualTypeOf<{
      id: Generated<number>
      ref: string
    }>()
  })

  it('leaves an unqualified table keyed by its bare name', () => {
    const users = table('users', { id: serial().primaryKey() })
    type DB = SchemaToTypes<{ users: typeof users }>
    expectTypeOf<keyof DB>().toEqualTypeOf<'users'>()
  })

  it("keys pgSchema('public') tables bare, matching the runtime collapse", () => {
    // The runtime drops `public` so `pgSchema('public').table('users')` and
    // `table('users')` share a snapshot key. If the TYPE said
    // 'public.users' while the runtime said 'users', every query built off
    // KickDbSchema would name a table the migration never created.
    const pub = pgSchema('public')
    const users = pub.table('users', { id: serial().primaryKey() })
    type DB = SchemaToTypes<{ users: typeof users }>
    expectTypeOf<keyof DB>().toEqualTypeOf<'users'>()
  })

  it('keeps two schemas with same-named tables as distinct keys', () => {
    const events = pgSchema('billing').table('events', { id: serial().primaryKey() })
    const auditEvents = pgSchema('audit').table('events', { id: serial().primaryKey() })
    type DB = SchemaToTypes<{ events: typeof events; auditEvents: typeof auditEvents }>
    expectTypeOf<keyof DB>().toEqualTypeOf<'billing.events' | 'audit.events'>()
  })

  it('mixes qualified and unqualified tables in one map', () => {
    const users = table('users', { id: serial().primaryKey() })
    const invoices = pgSchema('billing').table('invoices', { id: serial().primaryKey() })
    type DB = SchemaToTypes<{ users: typeof users; invoices: typeof invoices }>
    expectTypeOf<keyof DB>().toEqualTypeOf<'users' | 'billing.invoices'>()
  })
})
