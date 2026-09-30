import { pushClassMeta, getClassMeta } from './metadata'
import { reportError } from './observers'
import { createLogger } from './logger'

// String metadata key (post-Symbol migration). Slash-delimited
// `kick/cron` so it can't collide with adopter metadata keys.
const CRON_META = 'kick/cron'

const log = createLogger('KickCron')

export interface CronOptions<Meta extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Stable job name for logs, error reports and `runCronJobs({ name })`.
   * Defaults to `ClassName.method`.
   */
  name?: string
  /** Human-readable label for logging */
  description?: string
  /** IANA timezone (e.g. 'Africa/Nairobi'). Node runner and Workers only — Vercel crons are UTC. */
  timezone?: string
  /** Run once at startup (Node server), before the first scheduled tick */
  runOnInit?: boolean
  /**
   * Allow a run to start while the previous one is still going. Default
   * `false`: a tick that finds the job busy is skipped, so a job slower than
   * its interval never stacks up.
   */
  overlap?: boolean
  /**
   * Turn the job off without removing the decorator — a boolean, or a function
   * checked on every tick (e.g. `() => process.env.JOBS === 'on'`).
   */
  enabled?: boolean | (() => boolean)
  /**
   * Free-form data for the job: arguments the handler reads from its run
   * context (`run.meta`), and anything a custom runner or the DevTools want
   * to know. Stored as-is with the job metadata.
   */
  meta?: Meta
}

export interface CronJobMeta<
  Meta extends Record<string, unknown> = Record<string, unknown>,
> extends CronOptions<Meta> {
  expression: string
  handlerName: string
}

/** What a `@Cron` handler receives when it runs. */
export interface CronRun<Meta extends Record<string, unknown> = Record<string, unknown>> {
  name: string
  expression: string
  meta: Meta
  firedAt: Date
  /** What started this run. */
  trigger: 'schedule' | 'init' | 'http' | 'workers' | 'manual'
}

// Cron format: minute hour day month weekday
// Examples:
//   '* * * * *'       - every minute
//   '0 * * * *'       - every hour
//   '0 0 * * *'       - daily at midnight
//   '0 9 * * MON-FRI' - weekdays at 9am
//   '0 0 1 * *'       - first of each month

/**
 * Every class that declares at least one `@Cron` job, keyed by class name like
 * the DI registry: an HMR re-evaluation replaces the old class instead of
 * leaving it to run beside the new one.
 */
const cronClasses = new Map<string, Function>()

/**
 * Schedule a method to run on a cron expression.
 *
 * - On the Node server, `KickCronAdapter()` schedules it (opt-in; install the
 *   optional peer `croner`). Without it — or with your own adapter — `@Cron`
 *   only records metadata.
 * - On Vercel, `kick build:vercel` emits a cron entry that triggers it.
 * - On Cloudflare Workers, the web entry's `scheduled()` runs it.
 *
 * The handler receives a {@link CronRun} (name, expression, `meta`, trigger).
 *
 * @param expression - Standard 5-part cron: minute hour day month weekday.
 * @example
 * ```ts
 * @Cron('0 * * * *', { name: 'digest', meta: { batch: 500 } })
 * async sendDigest(run: CronRun<{ batch: number }>) {
 *   await this.mailer.flush(run.meta.batch)
 * }
 * ```
 */
export function Cron<Meta extends Record<string, unknown> = Record<string, unknown>>(
  expression: string,
  options?: CronOptions<Meta>,
): MethodDecorator {
  return (target, propertyKey) => {
    pushClassMeta<CronJobMeta<Meta>>(CRON_META, target.constructor, {
      ...options,
      expression,
      handlerName: propertyKey as string,
    })
    cronClasses.set(target.constructor.name, target.constructor)
  }
}

/** Read cron jobs registered on a class */
export function getCronJobs(target: any): CronJobMeta[] {
  return getClassMeta<CronJobMeta[]>(CRON_META, target, [])
}

/** One declared job, ready to run: its class, metadata and resolved name. */
export interface CronJob extends CronJobMeta {
  name: string
  /** {@link cronScheduleId} of the expression — how HTTP triggers address it. */
  scheduleId: string
  target: Function
}

/**
 * Every `@Cron` job whose class the container can resolve. Classes the
 * container doesn't know (not in a module, or left over from before an HMR
 * reload) are skipped.
 */
export function listCronJobs(container: { has(token: unknown): boolean }): CronJob[] {
  const jobs: CronJob[] = []
  for (const target of cronClasses.values()) {
    if (!container.has(target)) continue
    for (const meta of getCronJobs(target)) {
      jobs.push({
        ...meta,
        name: meta.name ?? `${target.name}.${meta.handlerName}`,
        scheduleId: cronScheduleId(meta.expression),
        target,
      })
    }
  }
  return jobs
}

/** Whether the job's `enabled` option currently allows it to run. */
export function isCronJobEnabled(job: Pick<CronJobMeta, 'enabled'>): boolean {
  const { enabled } = job
  return typeof enabled === 'function' ? enabled() : enabled !== false
}

const running = new Set<string>()

/**
 * Run one job now: resolve its class from the container and call the handler
 * with a {@link CronRun}. Skips a disabled job, and — unless `overlap: true` —
 * a job whose previous run hasn't finished. A failure is logged and reported to
 * the error observers (`source: 'cron'`), then rethrown for the caller.
 * Returns whether the job ran.
 */
export async function runCronJob(
  job: CronJob,
  container: { resolve(token: unknown): unknown },
  trigger: CronRun['trigger'],
): Promise<boolean> {
  if (!isCronJobEnabled(job)) return false
  // Keyed by class + method: `name` is user-chosen and may repeat.
  const key = `${job.target.name}.${job.handlerName}`
  if (!job.overlap && running.has(key)) {
    log.warn(`${job.name} is still running — skipped this tick`)
    return false
  }
  running.add(key)
  try {
    const instance = container.resolve(job.target) as Record<string, (run: CronRun) => unknown>
    await instance[job.handlerName]({
      name: job.name,
      expression: job.expression,
      meta: job.meta ?? {},
      firedAt: new Date(),
      trigger,
    })
    return true
  } catch (err) {
    log.error({ err }, `Cron job ${job.name} failed`)
    reportError(err, {
      source: 'cron',
      context: { job: job.name, expression: job.expression, trigger },
    })
    throw err
  } finally {
    running.delete(key)
  }
}

/**
 * Run every job matching `filter` (by name, schedule id, or exact expression),
 * in parallel. Resolves once all have settled; never rejects — failures are
 * already reported. Returns how many ran and how many failed.
 */
export async function runCronJobs(
  container: { has(token: unknown): boolean; resolve(token: unknown): unknown },
  filter: { name?: string; scheduleId?: string; expression?: string },
  trigger: CronRun['trigger'],
): Promise<{ ran: number; failed: number }> {
  const jobs = listCronJobs(container).filter(
    (job) =>
      (filter.name === undefined || job.name === filter.name) &&
      (filter.scheduleId === undefined || job.scheduleId === filter.scheduleId) &&
      (filter.expression === undefined || job.expression === filter.expression),
  )
  const results = await Promise.allSettled(jobs.map((job) => runCronJob(job, container, trigger)))
  return {
    ran: results.filter((r) => r.status === 'fulfilled' && r.value).length,
    failed: results.filter((r) => r.status === 'rejected').length,
  }
}

/**
 * A short, stable id for a cron expression (FNV-1a, base 36) — how HTTP
 * triggers address a schedule. Derived from the expression, not the class or
 * method name, because a minified serverless bundle may rename classes; the
 * CLI computes the same id from source at build time.
 */
export function cronScheduleId(expression: string): string {
  let hash = 0x811c9dc5
  for (const char of expression.trim().replace(/\s+/g, ' ')) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export { CRON_META }
