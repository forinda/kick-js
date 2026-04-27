import { describe, it, expect } from 'vitest'
import {
  bigSerial,
  bigint,
  smallint,
  decimal,
  numeric,
  real,
  doublePrecision,
} from '@forinda/kickjs-db'

describe('numeric column builders', () => {
  it('bigSerial defaults to NOT NULL like serial', () => {
    expect(bigSerial().toJSON('id')).toEqual({
      name: 'id',
      type: 'bigserial',
      nullable: false,
      default: null,
      primaryKey: false,
    })
  })

  it('bigint / smallint emit canonical PG types', () => {
    expect(bigint().toJSON('big').type).toBe('bigint')
    expect(smallint().toJSON('s').type).toBe('smallint')
  })

  it('decimal(precision, scale) parameterizes', () => {
    expect(decimal(10, 2).toJSON('amount').type).toBe('decimal(10, 2)')
    expect(decimal().toJSON('amount').type).toBe('decimal')
  })

  it('numeric is alias-shaped (same parameterization)', () => {
    expect(numeric(8, 4).toJSON('x').type).toBe('numeric(8, 4)')
  })

  it('real / doublePrecision are bare types', () => {
    expect(real().toJSON('r').type).toBe('real')
    expect(doublePrecision().toJSON('d').type).toBe('double precision')
  })
})
