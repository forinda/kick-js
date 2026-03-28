import { Logger } from '@forinda/kickjs'

const log = Logger.for('CronScheduler')

// ── CronScheduler Interface ─────────────────────────────────────────────

/**
 * Abstract scheduler backend. Implement this interface to use any
 * cron library or timer strategy with the CronAdapter.
 *
 * KickJS ships two built-in implementations:
 * - `CronerScheduler` — production-grade (requires `croner`)
 * - `IntervalScheduler` — zero-dep fallback (setInterval-based)
 *
 * @example
 * ```ts
 * // Custom scheduler using node-cron
 * import cron from 'node-cron'
 *
 * class NodeCronScheduler implements CronScheduler {
 *   private tasks: cron.ScheduledTask[] = []
 *
 *   schedule(expression, callback, options) {
 *     const task = cron.schedule(expression, callback, {
 *       timezone: options?.timezone,
 *     })
 *     this.tasks.push(task)
 *     return task
 *   }
 *
 *   stop(handle) { handle.stop() }
 *   stopAll() { this.tasks.forEach(t => t.stop()); this.tasks = [] }
 * }
 * ```
 */
export interface CronScheduler {
  /** Schedule a callback using a cron expression. Returns an opaque handle. */
  schedule(
    expression: string,
    callback: () => void | Promise<void>,
    options?: { timezone?: string },
  ): any

  /** Stop a single scheduled job by its handle. */
  stop(handle: any): void

  /** Stop all scheduled jobs. Called on shutdown. */
  stopAll(): void
}

// ── CronerScheduler (production) ────────────────────────────────────────

/**
 * Production-grade scheduler powered by `croner`.
 *
 * Features:
 * - Full cron syntax: 5, 6, or 7 fields (with seconds and year)
 * - OCPS 1.4 compliant
 * - Timezone and DST support
 * - Advanced patterns: L (last), W (weekday), # (nth occurrence)
 * - Zero drift — fires at exact cron boundaries
 *
 * Requires `croner` as a peer dependency:
 * ```bash
 * pnpm add croner
 * ```
 *
 * @example
 * ```ts
 * import { CronAdapter, CronerScheduler } from '@forinda/kickjs-cron'
 *
 * new CronAdapter({
 *   services: [ReportService],
 *   scheduler: new CronerScheduler(),
 * })
 * ```
 */
export class CronerScheduler implements CronScheduler {
  private CronClass: any
  private jobs: any[] = []

  /**
   * @param cronerModule - Optional: pass the croner module directly to avoid
   *   dynamic import issues in bundlers. e.g. `new CronerScheduler(require('croner'))`
   */
  constructor(cronerModule?: { Cron: any } | any) {
    if (cronerModule) {
      this.CronClass = cronerModule.Cron ?? cronerModule
    }
  }

  /** @internal Load croner dynamically if not passed via constructor */
  async init(): Promise<void> {
    if (this.CronClass) return
    try {
      const mod: any = await import('croner')
      this.CronClass = mod.Cron ?? mod
    } catch {
      throw new Error('CronerScheduler requires the "croner" package. Install it: pnpm add croner')
    }
  }

  schedule(
    expression: string,
    callback: () => void | Promise<void>,
    options?: { timezone?: string },
  ): any {
    if (!this.CronClass) {
      throw new Error(
        'CronerScheduler not initialized. Ensure CronAdapter calls init() ' +
          'or pass the croner module to the constructor.',
      )
    }
    const job = new this.CronClass(
      expression,
      { timezone: options?.timezone, protect: true },
      callback,
    )
    this.jobs.push(job)
    return job
  }

  stop(handle: any): void {
    handle?.stop?.()
    this.jobs = this.jobs.filter((j) => j !== handle)
  }

  stopAll(): void {
    for (const job of this.jobs) {
      job?.stop?.()
    }
    this.jobs = []
  }
}

// ── IntervalScheduler (zero-dep fallback) ───────────────────────────────

/**
 * Lightweight fallback scheduler using `setInterval`.
 * Converts common cron patterns to millisecond intervals.
 *
 * Use for development or simple recurring tasks. For production,
 * use CronerScheduler or implement a custom CronScheduler.
 *
 * Limitations:
 * - No timezone support
 * - No day-of-week, day-of-month, or month-specific scheduling
 * - Complex expressions fall back to 1-hour intervals
 * - Timer drift over long periods
 *
 * @example
 * ```ts
 * import { CronAdapter, IntervalScheduler } from '@forinda/kickjs-cron'
 *
 * new CronAdapter({
 *   services: [ReportService],
 *   scheduler: new IntervalScheduler(),
 * })
 * ```
 */
export class IntervalScheduler implements CronScheduler {
  private timers: NodeJS.Timeout[] = []

  schedule(
    expression: string,
    callback: () => void | Promise<void>,
    options?: { timezone?: string },
  ): NodeJS.Timeout {
    const intervalMs = cronToMs(expression)
    if (intervalMs === null) {
      throw new Error(`Invalid cron expression: "${expression}"`)
    }
    if (options?.timezone) {
      log.warn(
        'IntervalScheduler does not support timezones. ' +
          'Install croner and use CronerScheduler for timezone support.',
      )
    }
    const timer = setInterval(async () => {
      try {
        await callback()
      } catch {
        // Swallowed — errors are handled by CronAdapter.runJob
      }
    }, intervalMs)
    this.timers.push(timer)
    return timer
  }

  stop(handle: NodeJS.Timeout): void {
    clearInterval(handle)
    this.timers = this.timers.filter((t) => t !== handle)
  }

  stopAll(): void {
    for (const timer of this.timers) {
      clearInterval(timer)
    }
    this.timers = []
  }
}

// ── Lightweight cron-to-ms parser ───────────────────────────────────────

// Converts simplified cron expressions to millisecond intervals.
// Used internally by IntervalScheduler.
function cronToMs(expression: string): number | null {
  const parts = expression.trim().split(/\s+/)

  let minute: string, hour: string
  if (parts.length === 5) {
    ;[minute, hour] = parts
  } else if (parts.length === 6) {
    ;[, minute, hour] = parts
  } else {
    return null
  }

  // Every N seconds: */N * * * * *
  if (parts.length === 6 && parts[0].startsWith('*/')) {
    const secs = parseInt(parts[0].slice(2), 10)
    if (!isNaN(secs) && secs > 0) return secs * 1000
  }

  // Every N minutes: */N * * * *
  if (minute.startsWith('*/')) {
    const mins = parseInt(minute.slice(2), 10)
    if (!isNaN(mins) && mins > 0) return mins * 60 * 1000
  }

  // Every hour: 0 * * * *
  if (minute === '0' && hour === '*') return 60 * 60 * 1000

  // Every N hours: 0 */N * * *
  if (minute === '0' && hour.startsWith('*/')) {
    const hrs = parseInt(hour.slice(2), 10)
    if (!isNaN(hrs) && hrs > 0) return hrs * 60 * 60 * 1000
  }

  // Every minute: * * * * *
  if (minute === '*' && hour === '*') return 60 * 1000

  // Daily: 0 0 * * * or 0 N * * *
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    return 24 * 60 * 60 * 1000
  }

  // Fallback
  log.warn(
    `Complex cron "${expression}" — using 1h interval. ` +
      'Install croner and use CronerScheduler for exact scheduling.',
  )
  return 60 * 60 * 1000
}
