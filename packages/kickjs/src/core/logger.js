import pino from 'pino';
const isDev = process.env.NODE_ENV !== 'production';
/** Root pino logger instance */
export const rootLogger = pino({
    level: process.env.LOG_LEVEL || 'info',
    ...(isDev
        ? {
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss.l',
                    singleLine: true,
                    ignore: 'pid,hostname,component',
                    messageFormat: '{if component}[{component}] {end}{msg}',
                },
            },
        }
        : {}),
});
/** Cache of named loggers to avoid creating duplicates */
const loggerCache = new Map();
/**
 * Named logger with component context.
 *
 * @example
 * ```ts
 * // Static factory — preferred
 * const log = Logger.for('UserService')
 * log.info('User created')
 * // Output: [UserService] User created
 *
 * // Shorthand function
 * const log = createLogger('OrderService')
 *
 * // Injectable — auto-named from class
 * class MyService {
 *   @Autowired() private logger!: Logger
 *   // or inject a named one:
 *   private log = Logger.for('MyService')
 * }
 * ```
 */
export class Logger {
    log;
    constructor(name) {
        this.log = name ? rootLogger.child({ component: name }) : rootLogger;
    }
    /** Create or retrieve a cached named logger */
    static for(name) {
        let cached = loggerCache.get(name);
        if (!cached) {
            cached = new Logger(name);
            loggerCache.set(name, cached);
        }
        return cached;
    }
    /** Create a child logger with a sub-component name */
    child(name) {
        return new Logger(name);
    }
    info(msg, ...args) {
        this.log.info(msg, ...args);
    }
    warn(msg, ...args) {
        this.log.warn(msg, ...args);
    }
    error(msgOrObj, msg, ...args) {
        this.log.error(msgOrObj, msg, ...args);
    }
    debug(msg, ...args) {
        this.log.debug(msg, ...args);
    }
    trace(msg, ...args) {
        this.log.trace(msg, ...args);
    }
    fatal(msg, ...args) {
        this.log.fatal(msg, ...args);
    }
}
/** Shorthand for Logger.for(name) */
export function createLogger(name) {
    return Logger.for(name);
}
/** @deprecated Use rootLogger instead */
export const logger = rootLogger;
//# sourceMappingURL=logger.js.map