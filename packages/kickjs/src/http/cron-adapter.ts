/**
 * `KickCronAdapter()` — runs `@Cron` jobs on the Node server.
 *
 * Named with the `Kick` prefix (adapter name and logger too) so it never
 * collides with an app's own `CronAdapter` — which is also why it is opt-in.
 *
 * Opt-in: `@Cron` only records metadata, and apps that schedule jobs with
 * their own adapter keep doing so — adding this one to such an app would run
 * every job twice. Register it once:
 *
 * ```ts
 * bootstrap({ modules, adapters: [KickCronAdapter()] })
 * ```
 *
 * Timing comes from `schedule` — any scheduler library, a few lines to wire —
 * or, without one, from the optional peer `croner` (`pnpm add croner`), loaded
 * only when there is a job to schedule. Each tick resolves the job's class
 * from the container (the same singletons a request gets) and calls
 * `runCronJob`, which applies `enabled` / `overlap` and reports failures to
 * the error observers.
 *
 * Several processes: in `bootstrap({ cluster })`, only the worker the primary
 * marks with `KICK_CRON_WORKER=1` schedules, so a job runs once per cluster.
 * Several separate instances (replicas behind a load balancer) each schedule
 * every job — turn it off on all but one (`KickCronAdapter({ enabled: false })`),
 * or have the job take a lock.
 *
 * @module @forinda/kickjs/http/cron-adapter
 */
import cluster from 'node:cluster'
import { createRequire } from 'node:module'
import { defineAdapter } from '../core/define-adapter'
import { createLogger } from '../core/logger'
import { listCronJobs, runCronJob, type CronJob } from '../core/cron'
import type { Container } from '../core/container'

const log = createLogger('KickCronAdapter')
const peerRequire = createRequire(import.meta.url)

/** Set by the cluster primary on the one worker that runs `KickCronAdapter` jobs. */
export const CRON_WORKER_ENV = 'KICK_CRON_WORKER'

/** A running schedule, as {@link CronScheduler} returns it. */
export interface CronSchedule {
  stop(): void
}

/**
 * Starts one job's timer: call `tick` on every match of `expression` (in
 * `timezone` when set) until `stop()`. The adapter does the rest — resolving
 * the job, `enabled`, `overlap`, error reporting, waiting on shutdown.
 *
 * @example
 * ```ts
 * import cron from 'node-cron'
 *
 * KickCronAdapter({
 *   schedule: (expression, { timezone }, tick) => {
 *     const task = cron.schedule(expression, tick, { timezone })
 *     // destroy(), not stop(): node-cron keeps stopped tasks.
 *     return { stop: () => task.destroy() }
 *   },
 * })
 * ```
 */
export type CronScheduler = (
  expression: string,
  options: { timezone?: string },
  tick: () => void,
) => CronSchedule

export interface CronAdapterOptions {
  /** Off for processes that should run no jobs (replicas, one-off scripts). Default `true`. */
  enabled?: boolean
  /** The scheduler that drives the jobs. Default: `croner`, which must then be installed. */
  schedule?: CronScheduler
}

type Schedule = CronSchedule

type CronerCtor = new (pattern: string, options: { timezone?: string }, fn: () => void) => Schedule

function croner(): CronScheduler | undefined {
  try {
    const Croner = (peerRequire('croner') as { Cron: CronerCtor }).Cron
    // No croner `name`: croner keeps names in a process-wide registry and
    // throws on a duplicate.
    return (expression, { timezone }, tick) =>
      new Croner(expression, timezone ? { timezone } : {}, tick)
  } catch {
    return undefined
  }
}

/** Whether this process should schedule jobs — one worker per cluster. */
function isCronProcess(): boolean {
  return !cluster.isWorker || process.env[CRON_WORKER_ENV] === '1'
}

export const KickCronAdapter = defineAdapter<CronAdapterOptions>({
  name: 'KickCronAdapter',
  defaults: { enabled: true },
  build(options) {
    const schedules: Schedule[] = []
    const inFlight = new Set<Promise<unknown>>()
    let jobs: CronJob[] = []

    return {
      afterStart({ container }) {
        if (options.enabled === false || !isCronProcess()) return
        jobs = listCronJobs(container)
        if (jobs.length === 0) return

        const schedule = options.schedule ?? croner()
        if (!schedule) {
          log.warn(
            `${jobs.length} @Cron job(s) found but "croner" is not installed, so none will run. ` +
              'Install it (pnpm add croner), or pass KickCronAdapter({ schedule }).',
          )
          return
        }

        const run = (job: CronJob, trigger: 'schedule' | 'init') => {
          // Failures are already logged and reported by runCronJob.
          const p = runCronJob(job, container as Container, trigger).catch(() => {})
          inFlight.add(p)
          void p.finally(() => inFlight.delete(p))
        }

        for (const job of jobs) {
          schedules.push(
            schedule(job.expression, job.timezone ? { timezone: job.timezone } : {}, () =>
              run(job, 'schedule'),
            ),
          )
          if (job.runOnInit) run(job, 'init')
        }
        log.info(`Scheduled ${jobs.length} @Cron job(s): ${jobs.map((j) => j.name).join(', ')}`)
      },

      /**
       * Stops the schedules, then waits for running jobs so they don't lose
       * their dependencies mid-run. Also runs on every HMR reload, so a reload
       * never leaves a second copy ticking.
       */
      async shutdown() {
        for (const schedule of schedules.splice(0)) schedule.stop()
        await Promise.all(inFlight)
      },

      introspect() {
        return {
          protocolVersion: 1,
          name: 'KickCronAdapter',
          kind: 'adapter',
          state: {
            jobs: jobs.map((j) => ({
              name: j.name,
              expression: j.expression,
              timezone: j.timezone,
              description: j.description,
            })),
          },
        } as never
      },
    }
  },
})
