import { describe, expect, it } from 'vitest'
import { deltas, percentile } from '../spa/src/lib/stats'

describe('overview stats', () => {
  it('turns cumulative counts into per-interval rates, treating a reset as zero', () => {
    expect(deltas([3, 5, 5, 9, 2])).toEqual([2, 0, 4, 0])
    expect(deltas([7])).toEqual([])
  })

  it('takes the nearest-rank percentile', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(v, 95)).toBe(95)
    expect(percentile([5, 1, 3], 50)).toBe(3)
    expect(percentile([], 95)).toBeUndefined()
  })
})
