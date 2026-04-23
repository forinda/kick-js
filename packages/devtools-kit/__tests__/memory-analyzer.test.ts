import { describe, it, expect, afterEach } from 'vitest'
import {
  MemoryAnalyzer,
  PROTOCOL_VERSION,
  heapGrowthBytesPerSec,
  type RuntimeSnapshot,
} from '../src'

/**
 * Build a synthetic snapshot — only the fields the analyzer touches need
 * realistic values; everything else gets safe defaults.
 */
function makeSnap(timestamp: number, heapUsed: number): RuntimeSnapshot {
  return {
    protocolVersion: PROTOCOL_VERSION,
    timestamp,
    uptimeSec: 0,
    memory: {
      rss: 0,
      heapTotal: heapUsed * 2,
      heapUsed,
      external: 0,
      arrayBuffers: 0,
    },
    cpu: { userMicros: 0, systemMicros: 0 },
    eventLoop: { p50: 0, p95: 0, p99: 0, max: 0 },
    gc: { count: 0, totalPauseMs: 0 },
  }
}

describe('heapGrowthBytesPerSec (linear regression)', () => {
  it('returns 0 for empty windows', () => {
    expect(heapGrowthBytesPerSec([])).toBe(0)
  })

  it('returns 0 for single-sample windows (no slope possible)', () => {
    expect(heapGrowthBytesPerSec([makeSnap(0, 1000)])).toBe(0)
  })

  it('computes positive slope for monotonically growing heap', () => {
    // 1MB growth over 10 seconds → 100KB/sec
    const window = [makeSnap(0, 0), makeSnap(5000, 500_000), makeSnap(10_000, 1_000_000)]
    const slope = heapGrowthBytesPerSec(window)
    expect(slope).toBeCloseTo(100_000, -1)
  })

  it('computes negative slope for shrinking heap', () => {
    const window = [makeSnap(0, 1_000_000), makeSnap(5000, 500_000), makeSnap(10_000, 0)]
    expect(heapGrowthBytesPerSec(window)).toBeLessThan(0)
  })

  it('returns ~0 for flat heap usage', () => {
    const window = [makeSnap(0, 1_000_000), makeSnap(5000, 1_000_000), makeSnap(10_000, 1_000_000)]
    expect(Math.abs(heapGrowthBytesPerSec(window))).toBeLessThan(1)
  })

  it('handles non-uniform sample intervals', () => {
    // Same total growth (1MB over 10s ≈ 100KB/s) regardless of cadence
    const window = [
      makeSnap(0, 0),
      makeSnap(1000, 100_000),
      makeSnap(9000, 900_000),
      makeSnap(10_000, 1_000_000),
    ]
    expect(heapGrowthBytesPerSec(window)).toBeCloseTo(100_000, -1)
  })
})

describe('MemoryAnalyzer.health', () => {
  let analyzer: MemoryAnalyzer | null = null

  afterEach(() => {
    analyzer?.stop()
    analyzer = null
  })

  it('produces a health snapshot with the expected protocol version', () => {
    analyzer = new MemoryAnalyzer()
    analyzer.start()
    const window = [makeSnap(0, 1_000_000), makeSnap(1000, 1_000_000)]
    const health = analyzer.health(window)
    expect(health.protocolVersion).toBe(PROTOCOL_VERSION)
  })

  it('flags severity ok / warn / critical correctly', () => {
    analyzer = new MemoryAnalyzer()
    analyzer.start()

    // Flat → ok
    const flat = analyzer.health([makeSnap(0, 1_000_000), makeSnap(60_000, 1_000_000)])
    expect(flat.heapGrowthSeverity).toBe('ok')

    // 6MB/min ≈ 100KB/s → warn (threshold 87KB/s)
    const warn = analyzer.health([makeSnap(0, 0), makeSnap(60_000, 6_000_000)])
    expect(warn.heapGrowthSeverity).toBe('warn')

    // 30MB/min ≈ 500KB/s → critical (threshold 349KB/s)
    const critical = analyzer.health([makeSnap(0, 0), makeSnap(60_000, 30_000_000)])
    expect(critical.heapGrowthSeverity).toBe('critical')
  })

  it('reports activeHandles and per-type breakdown when supported', () => {
    analyzer = new MemoryAnalyzer()
    analyzer.start()
    const health = analyzer.health([makeSnap(0, 0), makeSnap(1000, 0)])
    // Node 17+ supports getActiveResourcesInfo; we run on Node 20+
    expect(health.activeHandles).toBeGreaterThanOrEqual(0)
    expect(typeof health.handlesByType).toBe('object')
  })

  it('heapUtilization is between 0 and 1', () => {
    analyzer = new MemoryAnalyzer()
    analyzer.start()
    const health = analyzer.health([makeSnap(0, 0), makeSnap(1000, 0)])
    expect(health.heapUtilization).toBeGreaterThanOrEqual(0)
    expect(health.heapUtilization).toBeLessThanOrEqual(1)
  })

  it('gcReclaimRatio defaults to 1 when no GCs have been observed', () => {
    analyzer = new MemoryAnalyzer()
    analyzer.start()
    expect(analyzer.gcReclaimRatio()).toBe(1)
  })

  it('respects custom growthThresholds', () => {
    analyzer = new MemoryAnalyzer({
      growthThresholds: { warnBytesPerSec: 1_000, criticalBytesPerSec: 10_000 },
    })
    analyzer.start()
    // 5KB/s → warn (above 1KB/s, below 10KB/s)
    const window = [makeSnap(0, 0), makeSnap(1000, 5000)]
    expect(analyzer.health(window).heapGrowthSeverity).toBe('warn')
  })
})

describe('MemoryAnalyzer — lifecycle', () => {
  it('start() is idempotent', () => {
    const analyzer = new MemoryAnalyzer()
    analyzer.start()
    analyzer.start()
    analyzer.stop()
  })

  it('stop() before start() is a no-op', () => {
    const analyzer = new MemoryAnalyzer()
    expect(() => analyzer.stop()).not.toThrow()
  })
})

describe('MemoryAnalyzer.activeHandlesByType (static)', () => {
  it('returns an object (possibly empty on older runtimes)', () => {
    const handles = MemoryAnalyzer.activeHandlesByType()
    expect(typeof handles).toBe('object')
    expect(handles).not.toBeNull()
  })

  it('all values are positive integers', () => {
    const handles = MemoryAnalyzer.activeHandlesByType()
    for (const count of Object.values(handles)) {
      expect(Number.isInteger(count)).toBe(true)
      expect(count).toBeGreaterThan(0)
    }
  })
})
