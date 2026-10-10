/**
 * `@Cron` jobs for the Jobs tab: every job the container can resolve, its
 * next run, and what happened when it last ran — whatever runs it (KickJS's
 * `KickCronAdapter`, an app's own croner adapter, a serverless trigger).
 *
 * Run stats come from wrapping each job's method on its class once: the
 * runner resolves the instance and calls the method, so the wrapper sees every
 * run without the runner knowing DevTools exists.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { isCronJobEnabled, listCronJobs, runCronJob, type CronJob } from '@forinda/kickjs'

export interface CronJobStats {
  runs: number
  failures: number
  /** Runs in progress now. */
  running: number
  lastStartedAt?: number
  lastDurationMs?: number
  lastOutcome?: 'ok' | 'failed'
  lastError?: string
}

export interface CronJobEntry {
  name: string
  className: string
  handler: string
  expression: string
  timezone?: string
  description?: string
  enabled: boolean
  overlap: boolean
  runOnInit: boolean
  /** Epoch ms of the next tick, when `croner` is installed to work it out. */
  nextRunAt: number | null
  stats: CronJobStats
}

type Container = Parameters<typeof listCronJobs>[0] & { resolve(token: unknown): unknown }

const TRACKED = Symbol.for('kickjs.devtools.cronTracked')
const stats = new Map<string, CronJobStats>()

const keyOf = (job: Pick<CronJob, 'target' | 'handlerName'>): string =>
  `${job.target.name}.${job.handlerName}`

function statsFor(key: string): CronJobStats {
  let s = stats.get(key)
  if (!s) stats.set(key, (s = { runs: 0, failures: 0, running: 0 }))
  return s
}

/**
 * Wrap each job's method once so its runs are counted. A sync handler stays
 * sync; a promise is passed through after its outcome is recorded.
 */
export function trackCronJobs(jobs: readonly CronJob[]): void {
  for (const job of jobs) {
    const proto = job.target.prototype as Record<string, unknown>
    const original = proto[job.handlerName]
    if (typeof original !== 'function' || (original as { [TRACKED]?: true })[TRACKED]) continue
    const s = statsFor(keyOf(job))
    const settle = (startedAt: number, error?: unknown): void => {
      s.running--
      s.runs++
      s.lastDurationMs = performance.now() - startedAt
      s.lastOutcome = error === undefined ? 'ok' : 'failed'
      if (error !== undefined) {
        s.failures++
        s.lastError = error instanceof Error ? error.message : String(error)
      }
    }
    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      s.running++
      s.lastStartedAt = Date.now()
      const startedAt = performance.now()
      let result: unknown
      try {
        result = (original as (...a: unknown[]) => unknown).apply(this, args)
      } catch (err) {
        settle(startedAt, err ?? new Error('threw'))
        throw err
      }
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).then(
          (value) => {
            settle(startedAt)
            return value
          },
          (err: unknown) => {
            settle(startedAt, err ?? new Error('rejected'))
            throw err
          },
        )
      }
      settle(startedAt)
      return result
    }
    Object.defineProperty(wrapped, TRACKED, { value: true })
    Object.defineProperty(wrapped, 'name', { value: (original as { name: string }).name })
    proto[job.handlerName] = wrapped
  }
}

/** Track every job the container can resolve — call at startup so early runs count. */
export function trackContainerCronJobs(container: Container): void {
  trackCronJobs(listCronJobs(container))
}

type NextRun = (expression: string, timezone?: string) => number | null

/** `croner` from the app's own dependencies, if it has it; otherwise no next-run times. */
function loadNextRun(): NextRun {
  try {
    const { Cron } = createRequire(join(process.cwd(), 'noop.js'))('croner') as {
      Cron: new (
        expr: string,
        opts: { paused: boolean; timezone?: string },
      ) => { nextRun(): Date | null; stop(): void }
    }
    return (expression, timezone) => {
      try {
        const c = new Cron(expression, { paused: true, ...(timezone ? { timezone } : {}) })
        const next = c.nextRun()
        c.stop()
        return next ? next.getTime() : null
      } catch {
        return null
      }
    }
  } catch {
    return () => null
  }
}
let nextRun: NextRun | undefined

/** Every resolvable `@Cron` job, tracked, with its next run and stats. */
export function cronSnapshot(container: Container): CronJobEntry[] {
  const jobs = listCronJobs(container)
  trackCronJobs(jobs)
  nextRun ??= loadNextRun()
  return jobs.map((job) => ({
    name: job.name,
    className: job.target.name,
    handler: job.handlerName,
    expression: job.expression,
    ...(job.timezone ? { timezone: job.timezone } : {}),
    ...(job.description ? { description: job.description } : {}),
    enabled: isCronJobEnabled(job),
    overlap: !!job.overlap,
    runOnInit: !!job.runOnInit,
    nextRunAt: nextRun!(job.expression, job.timezone),
    stats: { ...statsFor(keyOf(job)) },
  }))
}

/**
 * Start one job now (trigger `manual`) without waiting for it: a sweep can
 * take minutes, and its stats show when it settles. Skips a disabled job and,
 * unless it allows overlap, one that's already running.
 */
export function runCronJobNow(
  container: Container,
  name: string,
): { status: number; body: Record<string, unknown> } {
  const job = listCronJobs(container).find((j) => j.name === name)
  if (!job) return { status: 404, body: { error: `No cron job named "${name}"` } }
  if (!isCronJobEnabled(job)) return { status: 409, body: { error: `${name} is disabled` } }
  trackCronJobs([job])
  if (!job.overlap && statsFor(keyOf(job)).running > 0) {
    return { status: 409, body: { error: `${name} is already running` } }
  }
  // Failures are logged and reported by runCronJob, and land in the stats.
  void runCronJob(job, container, 'manual').catch(() => {})
  return { status: 202, body: { started: true } }
}
