import {
  Logger,
  type AppAdapter,
  type Container,
  getCronJobs,
  type CronJobMeta,
} from '@forinda/kickjs-core'

const log = Logger.for('CronAdapter')

export interface CronAdapterOptions {
  /**
   * Service classes that contain @Cron decorated methods.
   * These must also be decorated with @Service() for DI resolution.
   */
  services: any[]

  /** Enable/disable all cron jobs (default: true) */
  enabled?: boolean
}

/**
 * Cron adapter — scans services for @Cron decorated methods and
 * schedules them using a lightweight built-in scheduler.
 *
 * No external dependencies — uses setInterval with cron expression parsing.
 * For production, consider using node-cron or croner as the timer backend.
 *
 * @example
 * ```ts
 * import { CronAdapter } from '@forinda/kickjs-http/cron'
 *
 * bootstrap({
 *   modules,
 *   adapters: [
 *     new CronAdapter({ services: [ReportService, CleanupService] }),
 *   ],
 * })
 * ```
 */
export class CronAdapter implements AppAdapter {
  name = 'CronAdapter'
  private timers: NodeJS.Timeout[] = []
  private enabled: boolean

  constructor(private options: CronAdapterOptions) {
    this.enabled = options.enabled ?? true
  }

  afterStart(_server: any, container: Container): void {
    if (!this.enabled) {
      log.info('Cron disabled')
      return
    }

    let totalJobs = 0

    for (const ServiceClass of this.options.services) {
      const jobs = getCronJobs(ServiceClass)
      if (jobs.length === 0) continue

      const instance = container.resolve(ServiceClass)

      for (const job of jobs) {
        const intervalMs = cronToMs(job.expression)
        if (intervalMs === null) {
          log.warn(
            `Invalid cron expression: "${job.expression}" on ${ServiceClass.name}.${job.handlerName}`,
          )
          continue
        }

        const label = job.description ?? `${ServiceClass.name}.${job.handlerName}`

        // Run on init if requested
        if (job.runOnInit) {
          this.runJob(instance, job, label)
        }

        // Schedule recurring execution
        const timer = setInterval(() => {
          this.runJob(instance, job, label)
        }, intervalMs)

        this.timers.push(timer)
        totalJobs++

        log.info(`Scheduled: ${label} (${job.expression} ≈ ${formatMs(intervalMs)})`)
      }
    }

    if (totalJobs > 0) {
      log.info(`${totalJobs} cron job(s) active`)
    }
  }

  private async runJob(instance: any, job: CronJobMeta, label: string): Promise<void> {
    try {
      await instance[job.handlerName]()
    } catch (err: any) {
      log.error({ err }, `Cron job failed: ${label}`)
    }
  }

  shutdown(): void {
    for (const timer of this.timers) {
      clearInterval(timer)
    }
    this.timers = []
    log.info('All cron jobs stopped')
  }
}

// ── Lightweight cron parser ─────────────────────────────────────────────

/**
 * Convert a simplified cron expression to milliseconds interval.
 * Supports common patterns — for full cron spec, use node-cron.
 *
 * Patterns: * /N * * * (every N units), fixed values for basic scheduling.
 * Returns null for expressions too complex for interval-based scheduling.
 */
function cronToMs(expression: string): number | null {
  const parts = expression.trim().split(/\s+/)

  // Support 5-part (min hour day month weekday) or 6-part (sec min hour day month weekday)
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
    return 24 * 60 * 60 * 1000 // daily
  }

  // Fallback: run every hour for unrecognized patterns
  log.warn(
    `Complex cron "${expression}" — using 1h interval. For exact scheduling, install node-cron.`,
  )
  return 60 * 60 * 1000
}

function formatMs(ms: number): string {
  if (ms < 60000) return `${ms / 1000}s`
  if (ms < 3600000) return `${ms / 60000}m`
  return `${ms / 3600000}h`
}
