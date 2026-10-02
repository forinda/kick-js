import { describe, expect, it } from 'vitest'
import { nestedDateDecoder } from '../../src/client/nested-dates'

describe('nested date decoders', () => {
  it('Postgres: offsets kept, zone-less values and dates read as local time', () => {
    const decode = nestedDateDecoder('postgres')!
    expect(decode('timestamptz')!('2026-03-04T05:06:07.123+00:00')).toEqual(
      new Date('2026-03-04T05:06:07.123Z'),
    )
    expect(decode('timestamp')!('2026-03-04T05:06:07.123')).toEqual(
      new Date(2026, 2, 4, 5, 6, 7, 123),
    )
    expect(decode('date')!('2026-03-04')).toEqual(new Date(2026, 2, 4))
    expect(decode('text')).toBeUndefined()
  })

  it("MySQL: read in the pool's time zone", () => {
    const utc = nestedDateDecoder('mysql', { timezone: 'Z', dateStrings: false })!
    expect(utc('timestamp')!('2026-03-04 05:06:07.000000')).toEqual(
      new Date('2026-03-04T05:06:07Z'),
    )
    const plus2 = nestedDateDecoder('mysql', { timezone: '+02:00', dateStrings: false })!
    expect(plus2('timestamp')!('2026-03-04 05:06:07')).toEqual(new Date('2026-03-04T03:06:07Z'))
    const local = nestedDateDecoder('mysql')!
    expect(local('date')!('2026-03-04')).toEqual(new Date(2026, 2, 4))
  })

  it('MySQL: types dateStrings keeps as strings stay strings', () => {
    expect(
      nestedDateDecoder('mysql', { timezone: 'Z', dateStrings: true })!('timestamp'),
    ).toBeUndefined()
    const onlyDate = nestedDateDecoder('mysql', { timezone: 'Z', dateStrings: ['DATE'] })!
    expect(onlyDate('date')).toBeUndefined()
    expect(onlyDate('timestamp')).toBeDefined()
  })

  it('leaves anything it cannot parse as it was', () => {
    expect(nestedDateDecoder('postgres')!('timestamp')!('not a date')).toBe('not a date')
  })
})
