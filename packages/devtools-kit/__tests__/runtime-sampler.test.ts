import { describe, it, expect, afterEach } from 'vitest'
import { RuntimeSampler } from '../src'
import { PROTOCOL_VERSION } from '../src'

describe('RuntimeSampler', () => {
  let sampler: RuntimeSampler | null = null

  afterEach(() => {
    sampler?.stop()
    sampler = null
  })

  it('produces an initial snapshot synchronously on start()', () => {
    sampler = new RuntimeSampler({ intervalMs: 60_000 })
    sampler.start()
    const snap = sampler.latest()
    expect(snap).not.toBeNull()
    expect(snap!.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(snap!.memory.heapUsed).toBeGreaterThan(0)
    expect(snap!.uptimeSec).toBeGreaterThan(0)
  })

  it('reports zero CPU delta on the first sample', () => {
    sampler = new RuntimeSampler({ intervalMs: 60_000 })
    sampler.start()
    const first = sampler.latest()!
    expect(first.cpu.userMicros).toBe(0)
    expect(first.cpu.systemMicros).toBe(0)
  })

  it('takeSample() appends to history and respects bufferSize', () => {
    sampler = new RuntimeSampler({ intervalMs: 60_000, bufferSize: 3 })
    sampler.start()
    // start() already added 1 sample; add 4 more — buffer should keep last 3
    sampler.takeSample()
    sampler.takeSample()
    sampler.takeSample()
    sampler.takeSample()
    const history = sampler.history()
    expect(history).toHaveLength(3)
    // Timestamps are monotonically non-decreasing
    for (let i = 1; i < history.length; i++) {
      expect(history[i].timestamp).toBeGreaterThanOrEqual(history[i - 1].timestamp)
    }
  })

  it('start() is idempotent — second call is a no-op', () => {
    sampler = new RuntimeSampler({ intervalMs: 60_000 })
    sampler.start()
    const before = sampler.history().length
    sampler.start()
    // Should not have re-initialised + re-sampled
    expect(sampler.history().length).toBe(before)
    expect(sampler.isRunning()).toBe(true)
  })

  it('stop() clears the buffer and is idempotent', () => {
    sampler = new RuntimeSampler({ intervalMs: 60_000 })
    sampler.start()
    expect(sampler.isRunning()).toBe(true)
    sampler.stop()
    expect(sampler.isRunning()).toBe(false)
    expect(sampler.latest()).toBeNull()
    sampler.stop() // safe second call
    expect(sampler.isRunning()).toBe(false)
  })

  it('event-loop percentiles are non-negative', () => {
    sampler = new RuntimeSampler({ intervalMs: 60_000 })
    sampler.start()
    const snap = sampler.latest()!
    expect(snap.eventLoop.p50).toBeGreaterThanOrEqual(0)
    expect(snap.eventLoop.p95).toBeGreaterThanOrEqual(0)
    expect(snap.eventLoop.p99).toBeGreaterThanOrEqual(0)
    expect(snap.eventLoop.max).toBeGreaterThanOrEqual(0)
  })

  it('GC counters start at zero and never go negative', () => {
    sampler = new RuntimeSampler({ intervalMs: 60_000 })
    sampler.start()
    const snap = sampler.latest()!
    expect(snap.gc.count).toBeGreaterThanOrEqual(0)
    expect(snap.gc.totalPauseMs).toBeGreaterThanOrEqual(0)
  })
})
