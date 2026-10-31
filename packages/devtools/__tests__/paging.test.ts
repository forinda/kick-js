import { describe, expect, it } from 'vitest'
import { lastPageOf, pageOf, rangeLabel } from '../spa/src/lib/paging'

const rows = Array.from({ length: 23 }, (_, i) => i)

describe('paging', () => {
  it('finds the last page', () => {
    expect(lastPageOf(0, 10)).toBe(0)
    expect(lastPageOf(10, 10)).toBe(0)
    expect(lastPageOf(11, 10)).toBe(1)
  })

  it('returns the rows of a page', () => {
    expect(pageOf(rows, 0, 10)).toEqual(rows.slice(0, 10))
    expect(pageOf(rows, 2, 10)).toEqual([20, 21, 22])
  })

  it('falls back to the last page when the list shrank under it', () => {
    expect(pageOf(rows, 9, 10)).toEqual([20, 21, 22])
    expect(pageOf([], 3, 10)).toEqual([])
  })

  it('labels the range', () => {
    expect(rangeLabel(0, 50, 50, 137)).toBe('1–50 of 137')
    expect(rangeLabel(2, 50, 37, 137)).toBe('101–137 of 137')
    expect(rangeLabel(0, 50, 0, 0)).toBe('0 of 0')
    expect(rangeLabel(1, 10, 10)).toBe('11–20')
  })
})
