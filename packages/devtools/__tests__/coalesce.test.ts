import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coalesce } from '../spa/src/lib/coalesce'

describe('coalesce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs a burst of calls once, after the delay', () => {
    const fn = vi.fn()
    const run = coalesce(fn, 1000)
    for (let i = 0; i < 15; i++) run()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    run()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel drops the pending call', () => {
    const fn = vi.fn()
    const run = coalesce(fn, 1000)
    run()
    run.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })
})
