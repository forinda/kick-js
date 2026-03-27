import 'reflect-metadata';
declare const CRON_META: unique symbol;
export interface CronJobMeta {
    expression: string;
    handlerName: string;
    description?: string;
    timezone?: string;
    runOnInit?: boolean;
}
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
export declare function Cron(expression: string, options?: {
    description?: string;
    timezone?: string;
    runOnInit?: boolean;
}): MethodDecorator;
/** Read cron jobs registered on a class */
export declare function getCronJobs(target: any): CronJobMeta[];
export { CRON_META };
//# sourceMappingURL=cron.d.ts.map