import { describe, it, expect } from 'vitest'
import { serial, integer, varchar, text, boolean, timestamp } from '@forinda/kickjs-db'

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

describe('column builders — varchar, text, boolean, timestamp', () => {
  it('varchar(255) emits parameterised type string', () => {
    expect(varchar(255).toJSON('email').type).toBe('varchar(255)')
  })

  it('varchar() default length 255', () => {
    expect(varchar().toJSON('s').type).toBe('varchar(255)')
  })

  it('text uses unbounded type', () => {
    expect(text().toJSON('body').type).toBe('text')
  })

  it('boolean defaults nullable false-ish until notNull()', () => {
    expect(boolean().toJSON('flag').nullable).toBe(true)
    expect(boolean().notNull().toJSON('flag').nullable).toBe(false)
  })

  it('timestamp().defaultNow() resolves to a SQL default token', () => {
    const col = timestamp().defaultNow().toJSON('createdAt')
    expect(col.default).toBe('CURRENT_TIMESTAMP')
  })
})
