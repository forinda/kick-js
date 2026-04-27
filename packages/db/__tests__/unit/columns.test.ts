import { describe, it, expect } from 'vitest'
import { serial, integer } from '@forinda/kickjs-db'

describe('column builders — serial, integer', () => {
  it('serial defaults: not null, primary-key-eligible', () => {
    const col = serial()
    expect(col.toJSON('id')).toEqual({
      name: 'id',
      type: 'serial',
      nullable: false,
      default: null,
      primaryKey: false,
    })
  })

  it('serial().primaryKey() flips primaryKey', () => {
    expect(serial().primaryKey().toJSON('id').primaryKey).toBe(true)
  })

  it('integer is nullable by default', () => {
    expect(integer().toJSON('age').nullable).toBe(true)
  })

  it('integer().notNull().default("0") sets defaults', () => {
    const col = integer().notNull().default('0').toJSON('counter')
    expect(col.nullable).toBe(false)
    expect(col.default).toBe('0')
  })
})
