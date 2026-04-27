import { describe, it, expect } from 'vitest'
import { char, timestamptz, date, time, interval, uuid } from '@forinda/kickjs-db'

describe('temporal + identity column builders', () => {
  it('char(n) parameterizes', () => {
    expect(char(2).toJSON('cc').type).toBe('char(2)')
  })

  it('char() defaults length 1', () => {
    expect(char().toJSON('cc').type).toBe('char(1)')
  })

  it('timestamptz', () => {
    expect(timestamptz().toJSON('t').type).toBe('timestamptz')
  })

  it('timestamptz().defaultNow() resolves CURRENT_TIMESTAMP', () => {
    expect(timestamptz().defaultNow().toJSON('t').default).toBe('CURRENT_TIMESTAMP')
  })

  it('date / time / interval', () => {
    expect(date().toJSON('d').type).toBe('date')
    expect(time().toJSON('t').type).toBe('time')
    expect(interval().toJSON('i').type).toBe('interval')
  })

  it('uuid().defaultRandom() resolves to gen_random_uuid()', () => {
    const col = uuid().defaultRandom().toJSON('id')
    expect(col.type).toBe('uuid')
    expect(col.default).toBe('gen_random_uuid()')
  })
})
