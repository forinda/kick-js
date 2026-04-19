import {
  Logger,
  type AppAdapter,
  type AdapterContext,
  getCronJobs,
  type CronJobMeta,
} from '@forinda/kickjs'

import { type CronScheduler, CronerScheduler, IntervalScheduler } from './scheduler'

const log = Logger.for('CronAdapter')

// ── CronAdapter Options ─────────────────────────────────────────────────

export interface CronAdapterOptions {
  /**
   * Service classes that contain @Cron decorated methods.
   * Must also be decorated with @Service() for DI resolution.
   */
  services: any[]

  /** Enable/disable all cron jobs (default: true) */
  enabled?: boolean

  /**
   * Scheduler backend. Defaults to CronerScheduler (production-grade)
   * with automatic fallback to IntervalScheduler if croner is not installed.
   *
   * Built-in:
   * - `new CronerScheduler()` — full cron syntax, timezones, DST (requires `croner`)
   * - `new IntervalScheduler()` — zero-dep, setInterval-based (dev/simple tasks)
   *
   * Or implement `CronScheduler` for node-cron, node-schedule, cloud schedulers, etc.
   */
  scheduler?: CronScheduler
}

// ── CronAdapter ─────────────────────────────────────────────────────────

/**
 * Cron adapter — scans services for @Cron decorated methods and
 * schedules them using a pluggable scheduler backend.
 *
 * By default, tries `croner` for production-grade scheduling. Falls back
 * to `setInterval` if croner is not installed.
 *
 * @example
 * ```ts
 * import { CronAdapter } from '@forinda/kickjs-cron'
 *
 * // Auto-detect best available scheduler
 * bootstrap({
 *   adapters: [
 *     new CronAdapter({ services: [ReportService, CleanupService] }),
 *   ],
 * })
 *
 * // Explicit production scheduler
 * import { CronerScheduler } from '@forinda/kickjs-cron'
 *
 * bootstrap({
 *   adapters: [
 *     new CronAdapter({
 *       services: [ReportService],
 *       scheduler: new CronerScheduler(),
 *     }),
 *   ],
 * })
 *
 * // Custom scheduler
 * import { NodeCronScheduler } from './my-scheduler'
 *
 * bootstrap({
 *   adapters: [
 *     new CronAdapter({
 *       services: [ReportService],
 *       scheduler: new NodeCronScheduler(),
 *     }),
 *   ],
 * })
 * ```
 */
export class CronAdapter implements AppAdapter {
  name = 'CronAdapter'
  private scheduler: CronScheduler | null = null
  private readonly enabled: boolean

  constructor(private readonly options: CronAdapterOptions) {
    this.enabled = options.enabled ?? true
  }

  // Intentionally uses `afterStart` rather than `beforeStart`, even though
  // scheduling does not need the live HTTP server. `afterStart` is skipped by
  // `createTestApp` (which only runs `app.setup()`), and we want that skip:
  // unit tests should not start cron schedulers that fire jobs during the
  // test run. Production paths that call `app.start()` get full scheduling.
  async afterStart({ container }: AdapterContext): Promise<void> {
    if (!this.enabled) {
      log.info('Cron disabled')
      return
    }

    this.scheduler = await this.resolveScheduler()

    let totalJobs = 0

    for (const ServiceClass of this.options.services) {
      const jobs = getCronJobs(ServiceClass)
      if (jobs.length === 0) continue

      const instance = container.resolve(ServiceClass)

      for (const job of jobs) {
        const label = job.description ?? `${ServiceClass.name}.${job.handlerName}`

        try {
          if (job.runOnInit) {
            this.runJob(instance, job, label)
          }

          this.scheduler.schedule(job.expression, () => this.runJob(instance, job, label), {
            timezone: job.timezone,
          })

          totalJobs++
          log.info(
            `Scheduled: ${label} (${job.expression}${job.timezone ? ` [${job.timezone}]` : ''})`,
          )
        } catch (err: any) {
          log.error({ err }, `Failed to schedule: ${label}`)
        }
      }
    }

    if (totalJobs > 0) {
      const schedulerName = this.scheduler.constructor.name
      log.info(`${totalJobs} cron job(s) active [${schedulerName}]`)
    }
  }

  private async resolveScheduler(): Promise<CronScheduler> {
    if (this.options.scheduler) {
      return this.options.scheduler
    }

    // Try CronerScheduler first (production default)
    const croner = new CronerScheduler()
    try {
      await croner.init()
      log.info('Using CronerScheduler (production)')
      return croner
    } catch {
      log.warn(
        'croner not installed — using IntervalScheduler (limited cron support). ' +
          'For production: pnpm add croner',
      )
      return new IntervalScheduler()
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
    if (this.scheduler) {
      this.scheduler.stopAll()
    }
    log.info('All cron jobs stopped')
  }
}
