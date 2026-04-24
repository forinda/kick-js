import { Cron as CronJob } from 'croner'
import {
  Logger,
  defineAdapter,
  type AdapterContext,
  type Constructor,
} from '@forinda/kickjs'
import { getCronJobs } from './cron.decorator'

const log = Logger.for('CronAdapter')

export interface CronAdapterOptions {
  /** Service classes containing `@Cron`-decorated methods. */
  services: Constructor[]
  /** Disable all scheduled jobs (e.g. on a worker process that shouldn't run cron). */
  enabled?: boolean
}

/**
 * BYO cron adapter — replaces `@forinda/kickjs-cron` per the recipe in
 * `docs/guide/cron.md`. Schedules every method decorated with the local
 * `@Cron` decorator using `croner`.
 */
export const CronAdapter = defineAdapter<CronAdapterOptions>({
  name: 'CronAdapter',
  defaults: { enabled: true },
  build: (config) => {
    const jobs: CronJob[] = []

    return {
      async beforeStart({ container }: AdapterContext) {
        if (!config.enabled) return

        for (const ServiceClass of config.services) {
          const instance = container.resolve(ServiceClass) as Record<string, () => unknown>
          for (const meta of getCronJobs(ServiceClass)) {
            const job = new CronJob(
              meta.expression,
              { timezone: meta.timezone },
              async () => {
                try {
                  await instance[meta.handlerName]()
                } catch (err) {
                  log.error(
                    err as Error,
                    `Cron job ${ServiceClass.name}.${meta.handlerName} failed`,
                  )
                }
              },
            )
            jobs.push(job)
            log.info(
              `Scheduled ${ServiceClass.name}.${meta.handlerName} (${meta.expression})`,
            )
            if (meta.runOnInit) {
              instance[meta.handlerName]().catch?.(() => {})
            }
          }
        }
      },

      async shutdown() {
        for (const job of jobs) job.stop()
        log.info(`Stopped ${jobs.length} cron job(s)`)
      },
    }
  },
})
