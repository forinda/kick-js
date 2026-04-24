import { pushClassMeta, getClassMeta } from '@forinda/kickjs'

const CRON_META = 'app/cron/jobs'

export interface CronJobMeta {
  expression: string
  handlerName: string
  description?: string
  timezone?: string
  runOnInit?: boolean
}

export interface CronOptions {
  description?: string
  timezone?: string
  runOnInit?: boolean
}

/**
 * Local `@Cron` decorator — replaces the deprecated `@forinda/kickjs-cron`.
 * Marks a method on a `@Service()` class as a scheduled job. The local
 * `CronAdapter` reads this metadata at startup and schedules each job.
 */
export function Cron(expression: string, options?: CronOptions): MethodDecorator {
  return (target, propertyKey) => {
    pushClassMeta<CronJobMeta>(CRON_META, target.constructor, {
      expression,
      handlerName: propertyKey as string,
      description: options?.description,
      timezone: options?.timezone,
      runOnInit: options?.runOnInit,
    })
  }
}

/** Read all `@Cron`-decorated jobs from a service class. */
export function getCronJobs(target: object): CronJobMeta[] {
  return getClassMeta<CronJobMeta[]>(CRON_META, target, [])
}
