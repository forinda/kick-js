import { describe, it, expect, expectTypeOf } from 'vitest'
import type { Generated } from 'kysely'

import {
  customType,
  CustomColumnBuilder,
  table,
  serial,
  type SchemaToTypes,
} from '../../src/index'

// Adopter-defined opaque types — the whole point of customType.
type EncryptedString = string & { readonly __brand: 'EncryptedString' }
type ULID = string & { readonly __brand: 'ULID' }

describe('customType<T>()', () => {
  it('returns a factory whose build is a CustomColumnBuilder<T>', () => {
    const encrypted = customType<EncryptedString>({
      dataType: () => 'text',
    })
    const col = encrypted()
    expect(col).toBeInstanceOf(CustomColumnBuilder)
  })

  it('passes dataType() output through to the underlying ColumnBuilder', () => {
    const ulid = customType<ULID>({ dataType: () => 'char(26)' })
    const col = ulid()
    expect(col.__state().type).toBe('char(26)')
  })

  it('stores toDriver / fromDriver codecs on the builder for the hooks plugin', () => {
    const encrypted = customType<EncryptedString>({
      dataType: () => 'text',
      toDriver: (s) => `enc:${s}`,
      fromDriver: (raw) => `dec:${String(raw)}` as EncryptedString,
    })
    const col = encrypted()
    expect(col.toDriver).toBeTypeOf('function')
    expect(col.fromDriver).toBeTypeOf('function')
    expect(col.toDriver?.('hello' as EncryptedString)).toBe('enc:hello')
  })

  it('flows the phantom type through SchemaToTypes', () => {
    const encrypted = customType<EncryptedString>({ dataType: () => 'text' })
    const ulid = customType<ULID>({ dataType: () => 'char(26)' })

    const secrets = table('secrets', {
      id: serial().primaryKey(),
      key: ulid().notNull(),
      value: encrypted().notNull(),
      hint: encrypted(), // nullable — no .notNull()
    })
    const schema = { secrets }
    type DB = SchemaToTypes<typeof schema>

    expectTypeOf<DB['secrets']>().toEqualTypeOf<{
      id: Generated<number>
      key: ULID
      value: EncryptedString
      hint: EncryptedString | null
    }>()
  })
})
