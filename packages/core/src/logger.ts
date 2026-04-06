import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

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
})

/** Cache of named loggers to avoid creating duplicates */
const loggerCache = new Map<string, Logger>()

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
  private log: pino.Logger

  /**
   * Optional context provider for request-scoped log enrichment.
   * Set by the HTTP package to inject requestId from AsyncLocalStorage.
   * Returns extra fields to merge into every log call, or null if outside a request.
   */
  static _contextProvider: (() => Record<string, any> | null) | null = null

  constructor(name?: string) {
    this.log = name ? rootLogger.child({ component: name }) : rootLogger
  }

  /** Create or retrieve a cached named logger */
  static for(name: string): Logger {
    let cached = loggerCache.get(name)
    if (!cached) {
      cached = new Logger(name)
      loggerCache.set(name, cached)
    }
    return cached
  }

  /** Create a child logger with a sub-component name */
  child(name: string): Logger {
    return new Logger(name)
  }

  /** Get request context (requestId, etc.) if inside a request */
  private ctx(): Record<string, any> | undefined {
    return Logger._contextProvider?.() ?? undefined
  }

  info(msg: string, ...args: any[]) {
    const c = this.ctx()
    c ? this.log.info(c, msg, ...args) : this.log.info(msg, ...args)
  }

  warn(msg: string, ...args: any[]) {
    const c = this.ctx()
    c ? this.log.warn(c, msg, ...args) : this.log.warn(msg, ...args)
  }

  error(msgOrObj: any, msg?: string, ...args: any[]) {
    if (typeof msgOrObj === 'string') {
      const c = this.ctx()
      // Preserve full pino signature: error(msg, ...interpolationValues)
      // When called as error('msg', arg1, arg2), msg is the format string's first value
      const restArgs = msg !== undefined ? [msg, ...args] : args
      c ? this.log.error(c, msgOrObj, ...restArgs) : this.log.error(msgOrObj, ...restArgs)
    } else {
      const c = this.ctx()
      const obj = c ? { ...msgOrObj, ...c } : msgOrObj
      this.log.error(obj, msg, ...args)
    }
  }

  debug(msg: string, ...args: any[]) {
    const c = this.ctx()
    c ? this.log.debug(c, msg, ...args) : this.log.debug(msg, ...args)
  }

  trace(msg: string, ...args: any[]) {
    const c = this.ctx()
    c ? this.log.trace(c, msg, ...args) : this.log.trace(msg, ...args)
  }

  fatal(msg: string, ...args: any[]) {
    const c = this.ctx()
    c ? this.log.fatal(c, msg, ...args) : this.log.fatal(msg, ...args)
  }
}

/** Shorthand for Logger.for(name) */
export function createLogger(name: string): Logger {
  return Logger.for(name)
}

/** @deprecated Use rootLogger instead */
export const logger = rootLogger
