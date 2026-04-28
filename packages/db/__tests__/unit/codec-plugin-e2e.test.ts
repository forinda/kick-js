// Integration sanity check — wire the codec plugin through a real
// Kysely instance (DummyDriver) and confirm `toDriver` lands on the
// compiled query parameters.
//
// `compile()` runs the plugin's transformQuery, then Kysely emits the
// SQL and parameters that would have been sent to a real driver. We
// don't need to actually execute against a database; the contract is
// "encoded values reach the driver layer". DummyDriver is the cheapest
// way to assemble a working Kysely.

import { describe, it, expect } from 'vitest'
import {
  DummyDriver,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Dialect,
} from 'kysely'

import { createDbClient, customType, table, serial, varchar } from '../../src/index'

type Encrypted = string & { readonly __brand: 'Encrypted' }

const dummy: Dialect = {
  createAdapter: () => new PostgresAdapter(),
  createDriver: () => new DummyDriver(),
  createIntrospector: (db) => new PostgresIntrospector(db),
  createQueryCompiler: () => new PostgresQueryCompiler(),
}

const encrypted = customType<Encrypted>({
  dataType: () => 'text',
  toDriver: (s) => `enc:${s}`,
  fromDriver: (raw) => `dec:${String(raw)}` as Encrypted,
})

const secrets = table('secrets', {
  id: serial().primaryKey(),
  label: varchar(255).notNull(),
  value: encrypted().notNull(),
})

describe('codec plugin end-to-end', () => {
  it('encodes the customType column on a single-row INSERT', async () => {
    const db = createDbClient({ schema: { secrets }, dialect: dummy })
    const compiled = db
      .insertInto('secrets')
      .values({ label: 'hello', value: 'plaintext' as Encrypted })
      .compile()
    expect(compiled.parameters).toContain('enc:plaintext')
    expect(compiled.parameters).toContain('hello')
    await db.destroy()
  })

  it('encodes across multi-row INSERT', async () => {
    const db = createDbClient({ schema: { secrets }, dialect: dummy })
    const compiled = db
      .insertInto('secrets')
      .values([
        { label: 'a', value: 'one' as Encrypted },
        { label: 'b', value: 'two' as Encrypted },
      ])
      .compile()
    expect(compiled.parameters).toContain('enc:one')
    expect(compiled.parameters).toContain('enc:two')
    await db.destroy()
  })

  it('encodes UPDATE .set() values', async () => {
    const db = createDbClient({ schema: { secrets }, dialect: dummy })
    const compiled = db
      .updateTable('secrets')
      .set({ value: 'rotated' as Encrypted })
      .where('id', '=', 1)
      .compile()
    expect(compiled.parameters).toContain('enc:rotated')
    await db.destroy()
  })

  it('leaves non-customType columns alone', async () => {
    const db = createDbClient({ schema: { secrets }, dialect: dummy })
    const compiled = db
      .insertInto('secrets')
      .values({ label: 'plain-label', value: 'x' as Encrypted })
      .compile()
    expect(compiled.parameters).toContain('plain-label')
    // Encoder shouldn't run on non-customType columns even if a value
    // happens to be string.
    expect(compiled.parameters).not.toContain('enc:plain-label')
    await db.destroy()
  })
})
