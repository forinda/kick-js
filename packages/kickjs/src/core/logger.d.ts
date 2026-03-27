import pino from 'pino';
/** Root pino logger instance */
export declare const rootLogger: pino.Logger<never, boolean>;
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
export declare class Logger {
    private log;
    constructor(name?: string);
    /** Create or retrieve a cached named logger */
    static for(name: string): Logger;
    /** Create a child logger with a sub-component name */
    child(name: string): Logger;
    info(msg: string, ...args: any[]): void;
    warn(msg: string, ...args: any[]): void;
    error(msgOrObj: any, msg?: string, ...args: any[]): void;
    debug(msg: string, ...args: any[]): void;
    trace(msg: string, ...args: any[]): void;
    fatal(msg: string, ...args: any[]): void;
}
/** Shorthand for Logger.for(name) */
export declare function createLogger(name: string): Logger;
/** @deprecated Use rootLogger instead */
export declare const logger: pino.Logger<never, boolean>;
//# sourceMappingURL=logger.d.ts.map