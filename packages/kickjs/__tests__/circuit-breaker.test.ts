import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { CircuitBreaker, CircuitOpenError } from '../src/core/circuit-breaker'

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker

  beforeEach(() => {
    vi.useFakeTimers()
    breaker = new CircuitBreaker('test-service', {
      failureThreshold: 3,
      resetTimeout: 10_000,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('CLOSED state allows execution and returns result', async () => {
    const result = await breaker.execute(async () => 'ok')
    expect(result).toBe('ok')
    expect(breaker.getState()).toBe('closed')
  })

  it('transitions to OPEN after failure threshold is reached', async () => {
    const fail = () => breaker.execute(async () => { throw new Error('fail') })

    await expect(fail()).rejects.toThrow('fail')
    await expect(fail()).rejects.toThrow('fail')
    expect(breaker.getState()).toBe('closed')

    await expect(fail()).rejects.toThrow('fail')
    expect(breaker.getState()).toBe('open')
  })

  it('OPEN state rejects immediately with CircuitOpenError', async () => {
    // Force open
    for (let i = 0; i < 3; i++) {
      await breaker.execute(async () => { throw new Error('fail') }).catch(() => {})
    }

    const spy = vi.fn(async () => 'should not run')
    await expect(breaker.execute(spy)).rejects.toThrow(CircuitOpenError)
    await expect(breaker.execute(spy)).rejects.toThrow('is open')
    expect(spy).not.toHaveBeenCalled()
  })

  it('transitions to HALF_OPEN after resetTimeout elapses', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(async () => { throw new Error('fail') }).catch(() => {})
    }
    expect(breaker.getState()).toBe('open')

    vi.advanceTimersByTime(10_000)
    expect(breaker.getState()).toBe('half_open')
  })

  it('HALF_OPEN success transitions to CLOSED', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(async () => { throw new Error('fail') }).catch(() => {})
    }

    vi.advanceTimersByTime(10_000)
    expect(breaker.getState()).toBe('half_open')

    const result = await breaker.execute(async () => 'recovered')
    expect(result).toBe('recovered')
    expect(breaker.getState()).toBe('closed')
  })

  it('HALF_OPEN failure transitions back to OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(async () => { throw new Error('fail') }).catch(() => {})
    }

    vi.advanceTimersByTime(10_000)
    expect(breaker.getState()).toBe('half_open')

    await expect(
      breaker.execute(async () => { throw new Error('still failing') }),
    ).rejects.toThrow('still failing')

    expect(breaker.getState()).toBe('open')
  })

  it('HALF_OPEN limits concurrent requests to halfOpenMax', async () => {
    const breaker2 = new CircuitBreaker('limited', {
      failureThreshold: 2,
      resetTimeout: 5_000,
      halfOpenMax: 1,
    })

    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      await breaker2.execute(async () => { throw new Error('fail') }).catch(() => {})
    }

    vi.advanceTimersByTime(5_000)
    expect(breaker2.getState()).toBe('half_open')

    // First request should be allowed (but will fail), second should be rejected
    const p1 = breaker2.execute(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('slow fail')), 100)),
    )

    // While p1 is in flight, the attempt count is already at 1
    await expect(breaker2.execute(async () => 'blocked')).rejects.toThrow(CircuitOpenError)

    // Clean up p1
    vi.advanceTimersByTime(100)
    await expect(p1).rejects.toThrow('slow fail')
  })

  it('manual reset() returns to CLOSED state', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(async () => { throw new Error('fail') }).catch(() => {})
    }
    expect(breaker.getState()).toBe('open')

    breaker.reset()
    expect(breaker.getState()).toBe('closed')

    const result = await breaker.execute(async () => 'works again')
    expect(result).toBe('works again')
  })

  it('getStats() returns correct values', async () => {
    // Initial stats
    let stats = breaker.getStats()
    expect(stats.failures).toBe(0)
    expect(stats.successes).toBe(0)
    expect(stats.state).toBe('closed')
    expect(stats.lastFailure).toBeUndefined()

    // After some successes and failures
    await breaker.execute(async () => 'ok')
    await breaker.execute(async () => 'ok')
    await breaker.execute(async () => { throw new Error('fail') }).catch(() => {})

    stats = breaker.getStats()
    expect(stats.successes).toBe(2)
    expect(stats.failures).toBe(1)
    expect(stats.state).toBe('closed')
    expect(stats.lastFailure).toBeInstanceOf(Date)
  })

  it('getStats() reflects state transitions', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(async () => { throw new Error('fail') }).catch(() => {})
    }

    expect(breaker.getStats().state).toBe('open')
    expect(breaker.getStats().failures).toBe(3)

    vi.advanceTimersByTime(10_000)
    expect(breaker.getStats().state).toBe('half_open')
  })

  it('reset() clears all stats', async () => {
    await breaker.execute(async () => 'ok')
    await breaker.execute(async () => { throw new Error('fail') }).catch(() => {})

    breaker.reset()
    const stats = breaker.getStats()
    expect(stats.failures).toBe(0)
    expect(stats.successes).toBe(0)
    expect(stats.state).toBe('closed')
    expect(stats.lastFailure).toBeUndefined()
  })
})
