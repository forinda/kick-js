import { describe, expect, it } from 'vitest'
import { mergeSamples, deltas, percentile } from '../spa/src/lib/stats'

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

describe('mergeSamples', () => {
  const at = (timestamp: number) => ({ timestamp })
  it('keeps one sample per timestamp, in order, newest max', () => {
    const history = [at(1), at(2), at(3)]
    expect(mergeSamples(history, [at(3)], 10)).toEqual(history)
    expect(mergeSamples(history, [at(3), at(4), at(4), at(5)], 10)).toEqual([
      at(1),
      at(2),
      at(3),
      at(4),
      at(5),
    ])
    expect(mergeSamples(history, [at(4)], 2)).toEqual([at(3), at(4)])
  })

  it('takes history that arrives after a live sample', () => {
    expect(mergeSamples([at(5)], [at(3), at(4), at(5)], 10)).toEqual([at(3), at(4), at(5)])
  })
})
