/**
 * Derived memory health signals — heap-growth trend, GC efficiency,
 * active-handle inventory. All computed from a window of
 * {@link RuntimeSnapshot}s plus on-demand `process` and `v8` introspection.
 *
 * Pure functions where possible — the only stateful piece is
 * {@link MemoryAnalyzer}'s GC-efficiency tracker, which needs to remember
 * each GC's before/after heap size to compute reclaim ratios.
 *
 * @module @forinda/kickjs-devtools-kit/memory-analyzer
 */

import { performance, PerformanceObserver } from 'node:perf_hooks'
import { getHeapStatistics } from 'node:v8'
import { PROTOCOL_VERSION, type MemoryHealth, type RuntimeSnapshot } from './types'

/** Configuration knobs for {@link MemoryAnalyzer}. */
export interface MemoryAnalyzerOptions {
  /**
   * Heap-growth thresholds in bytes per second, used to bucket the
   * `heapGrowthSeverity` field. Defaults match the plan's "yellow > 5MB/min,
   * red > 20MB/min" rule, converted to per-second.
   */
  growthThresholds?: {
    /** Bytes/second at which severity flips to `warn`. Default: ~87KB/s (5MB/min). */
    warnBytesPerSec: number
    /** Bytes/second at which severity flips to `critical`. Default: ~349KB/s (20MB/min). */
    criticalBytesPerSec: number
  }
  /**
   * Maximum number of GC entries to remember when computing reclaim
   * ratio. Older entries get evicted FIFO. Default: 20 — enough to
   * smooth out one-off spikes without lagging on real degradation.
   */
  gcWindow?: number
}

/** One entry in the GC reclaim history. */
interface GcReclaim {
  /** Heap usage immediately before the GC (bytes). */
  before: number
  /** Heap usage immediately after the GC (bytes). */
  after: number
}

/**
 * Stateful analyzer for memory health. Owns a rolling window of GC
 * reclaim measurements + the active-handle inventory snapshot. Pure
 * functions for heap-growth trend live as static methods so callers
 * can use them without instantiating.
 */
export class MemoryAnalyzer {
  private readonly thresholds: { warnBytesPerSec: number; criticalBytesPerSec: number }
  private readonly gcWindow: number
  private readonly gcReclaims: GcReclaim[] = []
  private gcObserver: PerformanceObserver | null = null
  private heapBeforeGc = 0
  private started = false

  constructor(opts: MemoryAnalyzerOptions = {}) {
    this.thresholds = opts.growthThresholds ?? {
      // 5MB/min ≈ 87,381 B/s, 20MB/min ≈ 349,525 B/s
      warnBytesPerSec: 87_381,
      criticalBytesPerSec: 349_525,
    }
    this.gcWindow = opts.gcWindow ?? 20
  }

  /**
   * Start the GC reclaim observer. Idempotent. Must be called before
   * {@link gcReclaimRatio} returns meaningful data.
   */
  start(): void {
    if (this.started) return
    this.started = true
    this.heapBeforeGc = process.memoryUsage().heapUsed

    this.gcObserver = new PerformanceObserver((list) => {
      // For each GC entry, capture the "after" reading (current heap)
      // alongside the "before" we stashed at the previous GC's end.
      // First GC has no real "before" — we initialised it to the heap
      // size at start(), which is good enough.
      const after = process.memoryUsage().heapUsed
      for (const _entry of list.getEntries()) {
        this.gcReclaims.push({ before: this.heapBeforeGc, after })
        if (this.gcReclaims.length > this.gcWindow) {
          this.gcReclaims.shift()
        }
        this.heapBeforeGc = after
      }
    })
    this.gcObserver.observe({ entryTypes: ['gc'], buffered: false })
  }

  /** Stop the observer + clear history. Safe to call multiple times. */
  stop(): void {
    if (!this.started) return
    this.started = false
    this.gcObserver?.disconnect()
    this.gcObserver = null
    this.gcReclaims.length = 0
  }

  /**
   * Average GC reclaim ratio over the window. `1.0` = each GC freed
   * everything; `0.0` = each GC freed nothing (strong leak signal).
   * Returns `1` when no GCs have been observed yet (assume healthy).
   */
  gcReclaimRatio(): number {
    if (this.gcReclaims.length === 0) return 1
    let sum = 0
    let valid = 0
    for (const { before, after } of this.gcReclaims) {
      if (before <= 0) continue
      const ratio = (before - after) / before
      // Negative ratios (heap grew during GC) clamp to 0 so one
      // anomalous sample doesn't poison the average.
      sum += Math.max(0, ratio)
      valid++
    }
    return valid === 0 ? 1 : sum / valid
  }

  /**
   * Compose a {@link MemoryHealth} from a window of runtime snapshots.
   * Merges the analyzer's GC-reclaim data with heap-growth trend
   * (computed via linear regression on `memory.heapUsed`) and the
   * active-handles inventory.
   */
  health(window: readonly RuntimeSnapshot[]): MemoryHealth {
    const heapGrowthBytesPerSec = MemoryAnalyzer.heapGrowthBytesPerSec(window)
    const heapGrowthSeverity =
      heapGrowthBytesPerSec >= this.thresholds.criticalBytesPerSec
        ? 'critical'
        : heapGrowthBytesPerSec >= this.thresholds.warnBytesPerSec
          ? 'warn'
          : 'ok'

    const handles = MemoryAnalyzer.activeHandlesByType()
    const activeHandles = Object.values(handles).reduce((sum, n) => sum + n, 0)

    const heapStats = getHeapStatistics()
    const heapUtilization =
      heapStats.heap_size_limit > 0 ? heapStats.used_heap_size / heapStats.heap_size_limit : 0

    return {
      protocolVersion: PROTOCOL_VERSION,
      heapGrowthBytesPerSec,
      heapGrowthSeverity,
      gcReclaimRatio: this.gcReclaimRatio(),
      activeHandles,
      handlesByType: handles,
      heapUtilization,
    }
  }

  /**
   * Linear-regression slope of `heapUsed` over time, in bytes per
   * second. Negative slope means heap is shrinking. Pure function —
   * doesn't read any analyzer state.
   *
   * Uses ordinary least-squares with timestamps normalised to seconds
   * since the first sample so the slope unit is bytes/sec directly.
   * Returns `0` for windows with < 2 samples.
   */
  static heapGrowthBytesPerSec(window: readonly RuntimeSnapshot[]): number {
    if (window.length < 2) return 0
    const t0 = window[0].timestamp
    const xs: number[] = new Array(window.length)
    const ys: number[] = new Array(window.length)
    let sumX = 0
    let sumY = 0
    for (let i = 0; i < window.length; i++) {
      const x = (window[i].timestamp - t0) / 1000 // seconds since first sample
      const y = window[i].memory.heapUsed
      xs[i] = x
      ys[i] = y
      sumX += x
      sumY += y
    }
    const meanX = sumX / window.length
    const meanY = sumY / window.length
    let num = 0
    let den = 0
    for (let i = 0; i < window.length; i++) {
      const dx = xs[i] - meanX
      num += dx * (ys[i] - meanY)
      den += dx * dx
    }
    return den === 0 ? 0 : num / den
  }

  /**
   * Active-handle counts grouped by handle type. Built on top of
   * `process.getActiveResourcesInfo()` (Node 17+); returns an empty
   * object on older runtimes so callers don't have to feature-check.
   */
  static activeHandlesByType(): Record<string, number> {
    const fn = (process as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo
    if (typeof fn !== 'function') return {}
    const info = fn()
    const out: Record<string, number> = {}
    for (const type of info) {
      out[type] = (out[type] ?? 0) + 1
    }
    return out
  }
}

/**
 * Standalone helper — take one heap-growth reading without
 * instantiating {@link MemoryAnalyzer}. Re-exported from `index.ts` so
 * tests + tooling can call it directly.
 */
export function heapGrowthBytesPerSec(window: readonly RuntimeSnapshot[]): number {
  return MemoryAnalyzer.heapGrowthBytesPerSec(window)
}

/**
 * Mark the `performance` import as used so tsdown doesn't drop the
 * `node:perf_hooks` import at build time. The PerformanceObserver
 * is the actual consumer; this just keeps the import edge live for
 * the type-only path.
 */
void performance
