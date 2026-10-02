import { describe, expect, it, vi } from 'vitest'
import { retryDelay, retryPlan } from '../../src/client/wrap'

describe('transaction retry plan', () => {
  it('reads the retry option', () => {
    expect(retryPlan(undefined).attempts).toBe(1)
    expect(retryPlan(true).attempts).toBe(3)
    expect(retryPlan(5).attempts).toBe(5)
    expect(retryPlan({ attempts: 4, baseDelayMs: 5 })).toEqual({
      attempts: 4,
      baseDelayMs: 5,
      maxDelayMs: 1000,
    })
  })

  it('backs off exponentially with full jitter, capped', () => {
    const plan = retryPlan({ attempts: 10, baseDelayMs: 10, maxDelayMs: 50 })
    vi.spyOn(Math, 'random').mockReturnValue(1)
    expect([1, 2, 3, 4].map((n) => retryDelay(plan, n))).toEqual([10, 20, 40, 50])
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(retryDelay(plan, 3)).toBe(0)
    vi.restoreAllMocks()
  })
})
