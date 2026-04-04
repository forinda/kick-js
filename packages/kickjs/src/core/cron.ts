import { pushClassMeta, getClassMeta } from './metadata'

const CRON_META = Symbol('kick:cron')

export interface CronJobMeta {
  expression: string
  handlerName: string
  description?: string
  timezone?: string
  runOnInit?: boolean
}

// Cron format: minute hour day month weekday
// Examples:
//   '* * * * *'       - every minute
//   '0 * * * *'       - every hour
//   '0 0 * * *'       - daily at midnight
//   '0 9 * * MON-FRI' - weekdays at 9am
//   '0 0 1 * *'       - first of each month

/**
 * Schedule a method to run on a cron expression.
 * Requires a CronAdapter to be registered in bootstrap().
 *
 * @param expression - Standard 5-part cron: minute hour day month weekday.
 *   Use forward-slash for intervals (e.g. every 5 min, every 2 hours).
 * @param options.description - Human-readable label for logging
 * @param options.timezone - IANA timezone (e.g. 'America/New_York', 'UTC')
 * @param options.runOnInit - Run immediately on startup before first scheduled tick
 */
export function Cron(
  expression: string,
  options?: { description?: string; timezone?: string; runOnInit?: boolean },
): MethodDecorator {
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

/** Read cron jobs registered on a class */
export function getCronJobs(target: any): CronJobMeta[] {
  return getClassMeta<CronJobMeta[]>(CRON_META, target, [])
}

export { CRON_META }
