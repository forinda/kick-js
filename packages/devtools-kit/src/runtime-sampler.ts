/**
 * Tier-1 always-on monitoring — heap, CPU, event-loop delay, GC.
 *
 * Every signal here is cheap enough to sample once per second without
 * affecting the inspected app's hot path. Anything that requires a heap
 * walk, snapshot, or async_hooks instrumentation lives behind explicit
 * RPC routes in the DevTools runtime, NOT here.
 *
 * The sampler keeps a ring buffer of recent snapshots so the panel can
 * draw sparklines without re-asking the server for history. Default
 * window is 60 samples (~1 minute at the default 1-second interval).
 *
 * @module @forinda/kickjs-devtools-kit/runtime-sampler
 */

import { performance, monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks'
import { PROTOCOL_VERSION, type RuntimeSnapshot } from './types'

/** Configuration for {@link RuntimeSampler}. */
export interface RuntimeSamplerOptions {
  /** Sample interval in milliseconds. Default: 1000. */
  intervalMs?: number
  /** Ring-buffer size — number of past samples to retain. Default: 60. */
  bufferSize?: number
  /**
   * Resolution of the event-loop-delay histogram. Larger = more
   * precise tail percentiles, smaller = lower overhead. Default: 20ms,
   * matching Node's recommended starting point.
   */
  eventLoopResolutionMs?: number
}

/**
 * Sampled runtime metrics + a ring buffer of recent samples.
 *
 * Lifecycle: `start()` enables the event-loop monitor and the GC
 * observer; `stop()` tears them down + clears the buffer. Safe to
 * `start()` once, `stop()` once at process exit. Calling `start()`
 * twice is a no-op so adapter `beforeStart` hooks can be defensive.
 */
export class RuntimeSampler {
  private readonly intervalMs: number
  private readonly bufferSize: number
  private readonly histogram = monitorEventLoopDelay({ resolution: 20 })
  private readonly buffer: RuntimeSnapshot[] = []

  /** Cumulative GC stats updated by the PerformanceObserver. */
  private gcCount = 0
  private gcTotalPauseMs = 0

  /** GC observer reference so `stop()` can disconnect it. */
  private gcObserver: PerformanceObserver | null = null

  /** Polling timer — null when sampler is stopped. */
  private timer: ReturnType<typeof setInterval> | null = null

  /** Previous CPU usage, used to compute per-interval deltas. */
  private prevCpu: NodeJS.CpuUsage | null = null

  /** Set once; refusing to re-start prevents double-observers + drift. */
  private started = false

  constructor(opts: RuntimeSamplerOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 1000
    this.bufferSize = opts.bufferSize ?? 60
    if (opts.eventLoopResolutionMs !== undefined) {
      this.histogram = monitorEventLoopDelay({ resolution: opts.eventLoopResolutionMs })
    }
  }

  /**
   * Start sampling. Idempotent — second call is a no-op so adapter
   * `beforeStart` hooks can be safely defensive.
   */
  start(): void {
    if (this.started) return
    this.started = true

    this.histogram.enable()
    // `prevCpu` stays null until the first takeSample() — that path
    // returns a zero delta + stashes the baseline for subsequent diffs.
    // Setting it here would pollute the very first sample with the
    // microseconds elapsed between start() and takeSample().

    // GC observer accumulates count + duration; we read the running
    // totals into each snapshot rather than emitting per-event so the
    // ring buffer stays compact.
    this.gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        this.gcCount++
        this.gcTotalPauseMs += entry.duration
      }
    })
    // The 'gc' entry type was promoted out of `--no-experimental` in
    // Node 16+; assume it's available on our supported runtime (>=20).
    this.gcObserver.observe({ entryTypes: ['gc'], buffered: false })

    this.timer = setInterval(() => this.takeSample(), this.intervalMs)
    // Sampler shouldn't keep the process alive on its own — adapter
    // shutdown will call `stop()`, but if it doesn't (test harness, REPL)
    // we still want clean exit.
    this.timer.unref?.()

    // Take an initial sample so consumers see data before the first tick.
    this.takeSample()
  }

  /** Stop sampling. Safe to call multiple times. */
  stop(): void {
    if (!this.started) return
    this.started = false

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.gcObserver?.disconnect()
    this.gcObserver = null
    this.histogram.disable()
    this.histogram.reset()
    this.buffer.length = 0
    this.prevCpu = null
  }

  /** Most recent snapshot, or `null` if sampling never produced one. */
  latest(): RuntimeSnapshot | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null
  }

  /**
   * The full ring buffer, oldest-first. Returned as a copy so callers
   * can safely mutate without affecting the sampler's internal state.
   */
  history(): RuntimeSnapshot[] {
    return this.buffer.slice()
  }

  /** Take one sample synchronously and append it to the ring buffer. */
  takeSample(): RuntimeSnapshot {
    const now = performance.timeOrigin + performance.now()
    const memory = process.memoryUsage()

    // CPU is reported as cumulative microseconds; we want per-interval
    // deltas so the panel can chart instantaneous load.
    const currentCpu = process.cpuUsage()
    const cpuDelta = this.prevCpu
      ? {
          userMicros: currentCpu.user - this.prevCpu.user,
          systemMicros: currentCpu.system - this.prevCpu.system,
        }
      : { userMicros: 0, systemMicros: 0 }
    this.prevCpu = currentCpu

    // Histogram values are in nanoseconds — convert to ms for display.
    const eventLoop = {
      p50: this.histogram.percentile(50) / 1_000_000,
      p95: this.histogram.percentile(95) / 1_000_000,
      p99: this.histogram.percentile(99) / 1_000_000,
      max: this.histogram.max / 1_000_000,
    }
    // Reset the histogram so each sample reports the lag accumulated
    // during the most recent interval, not since the sampler started.
    this.histogram.reset()

    const snapshot: RuntimeSnapshot = {
      protocolVersion: PROTOCOL_VERSION,
      timestamp: now,
      uptimeSec: process.uptime(),
      memory,
      cpu: cpuDelta,
      eventLoop,
      gc: { count: this.gcCount, totalPauseMs: this.gcTotalPauseMs },
    }

    this.buffer.push(snapshot)
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift()
    }
    return snapshot
  }

  /** Whether the sampler is currently running. */
  isRunning(): boolean {
    return this.started
  }
}
