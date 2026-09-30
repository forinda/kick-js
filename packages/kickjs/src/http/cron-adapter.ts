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
 * Timing comes from the optional peer `croner` (`pnpm add croner`), loaded
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

export interface CronAdapterOptions {
  /** Off for processes that should run no jobs (replicas, one-off scripts). Default `true`. */
  enabled?: boolean
}

interface Schedule {
  stop(): void
}

type CronerCtor = new (pattern: string, options: { timezone?: string }, fn: () => void) => Schedule

function loadCroner(): CronerCtor | undefined {
  try {
    return (peerRequire('croner') as { Cron: CronerCtor }).Cron
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
    let jobs: CronJob[] = []

    return {
      afterStart({ container }) {
        if (options.enabled === false || !isCronProcess()) return
        jobs = listCronJobs(container)
        if (jobs.length === 0) return

        const Croner = loadCroner()
        if (!Croner) {
          log.warn(
            `${jobs.length} @Cron job(s) found but "croner" is not installed, so none will run. ` +
              'Install it: pnpm add croner',
          )
          return
        }

        const run = (job: CronJob, trigger: 'schedule' | 'init') =>
          // Failures are already logged and reported by runCronJob.
          runCronJob(job, container as Container, trigger).catch(() => {})

        for (const job of jobs) {
          schedules.push(
            new Croner(
              job.expression,
              // No croner `name`: croner keeps names in a process-wide registry
              // and throws on a duplicate.
              job.timezone ? { timezone: job.timezone } : {},
              () => void run(job, 'schedule'),
            ),
          )
          if (job.runOnInit) void run(job, 'init')
        }
        log.info(`Scheduled ${jobs.length} @Cron job(s): ${jobs.map((j) => j.name).join(', ')}`)
      },

      /** Also runs on every HMR reload, so a reload never leaves a second copy ticking. */
      shutdown() {
        for (const schedule of schedules.splice(0)) schedule.stop()
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
