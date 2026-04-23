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

// ── LoggerProvider interface ───────────────────────────────────────────

/**
 * Pluggable logger backend.
 *
 * Implement this interface to replace the default pino-based logging
 * with any logging library (winston, bunyan, console, etc.).
 */
export interface LoggerProvider {
  info(msg: string, ...args: any[]): void
  warn(msg: string, ...args: any[]): void
  error(msg: string, ...args: any[]): void
  debug(msg: string, ...args: any[]): void
  trace?(msg: string, ...args: any[]): void
  fatal?(msg: string, ...args: any[]): void
  /** Return a child provider scoped to the given component name */
  child(bindings: { component: string }): LoggerProvider
}

// ── PinoLoggerProvider (default) ───────────────────────────────────────

/** Default provider that delegates to the root pino instance */
class PinoLoggerProvider implements LoggerProvider {
  private log: pino.Logger

  constructor(pinoInstance?: pino.Logger) {
    this.log = pinoInstance ?? rootLogger
  }

  info(msg: string, ...args: any[]) {
    this.log.info(msg, ...args)
  }
  warn(msg: string, ...args: any[]) {
    this.log.warn(msg, ...args)
  }
  error(msg: string, ...args: any[]) {
    this.log.error(msg, ...args)
  }
  debug(msg: string, ...args: any[]) {
    this.log.debug(msg, ...args)
  }
  trace(msg: string, ...args: any[]) {
    this.log.trace(msg, ...args)
  }
  fatal(msg: string, ...args: any[]) {
    this.log.fatal(msg, ...args)
  }
  child(bindings: { component: string }): LoggerProvider {
    return new PinoLoggerProvider(this.log.child(bindings))
  }
}

// ── ConsoleLoggerProvider ──────────────────────────────────────────────

/**
 * Built-in fallback provider that uses `console.*` methods.
 * Useful for environments where pino is unavailable or undesired.
 */
export class ConsoleLoggerProvider implements LoggerProvider {
  private prefix: string

  constructor(prefix?: string) {
    this.prefix = prefix ?? ''
  }

  private fmt(msg: string): string {
    return this.prefix ? `[${this.prefix}] ${msg}` : msg
  }

  info(msg: string, ...args: any[]) {
    console.log(this.fmt(msg), ...args)
  }
  warn(msg: string, ...args: any[]) {
    console.warn(this.fmt(msg), ...args)
  }
  error(msg: string, ...args: any[]) {
    console.error(this.fmt(msg), ...args)
  }
  debug(msg: string, ...args: any[]) {
    console.debug(this.fmt(msg), ...args)
  }
  trace(msg: string, ...args: any[]) {
    console.trace(this.fmt(msg), ...args)
  }
  fatal(msg: string, ...args: any[]) {
    console.error(this.fmt(msg), ...args)
  }
  child(bindings: { component: string }): LoggerProvider {
    return new ConsoleLoggerProvider(bindings.component)
  }
}

// ── Active provider ────────────────────────────────────────────────────

let activeProvider: LoggerProvider = new PinoLoggerProvider()

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
 * // Pluggable backend
 * Logger.setProvider(new ConsoleLoggerProvider())
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
  private _provider: LoggerProvider
  private _providerVersion: number
  private _name?: string

  /**
   * Optional context provider for request-scoped log enrichment.
   * Set by the HTTP package to inject requestId from AsyncLocalStorage.
   * Returns extra fields to merge into every log call, or null if outside a request.
   */
  static _contextProvider: (() => Record<string, any> | null) | null = null

  /** Incremented on every setProvider/resetProvider so instances know to refresh */
  private static _providerVersion = 0

  constructor(name?: string) {
    this._name = name
    this._providerVersion = Logger._providerVersion
    this._provider = name ? activeProvider.child({ component: name }) : activeProvider
  }

  /** Re-derive the provider if setProvider() was called since construction/last access */
  private get provider(): LoggerProvider {
    if (this._providerVersion !== Logger._providerVersion) {
      this._providerVersion = Logger._providerVersion
      this._provider = this._name ? activeProvider.child({ component: this._name }) : activeProvider
    }
    return this._provider
  }

  /**
   * Replace the logging backend for **all** Logger instances created after
   * this call.  Clears the logger cache so subsequent `Logger.for()` calls
   * pick up the new provider.
   *
   * @example
   * ```ts
   * Logger.setProvider(new ConsoleLoggerProvider())
   * ```
   */
  static setProvider(provider: LoggerProvider): void {
    activeProvider = provider
    Logger._providerVersion++
    loggerCache.clear()
  }

  /** Return the currently active provider (useful for testing) */
  static getProvider(): LoggerProvider {
    return activeProvider
  }

  /**
   * Reset the provider back to the default pino-based implementation.
   * Primarily intended for test teardown.
   */
  static resetProvider(): void {
    activeProvider = new PinoLoggerProvider()
    Logger._providerVersion++
    loggerCache.clear()
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
    this.provider.info(msg, ...args)
  }

  warn(msg: string, ...args: any[]) {
    this.provider.warn(msg, ...args)
  }

  error(msgOrObj: any, msg?: string, ...args: any[]) {
    if (typeof msgOrObj === 'string') {
      this.provider.error(msgOrObj)
    } else if (msg) {
      this.provider.error(msg, ...args)
    } else {
      this.provider.error(String(msgOrObj))
    }
  }

  debug(msg: string, ...args: any[]) {
    this.provider.debug(msg, ...args)
  }

  trace(msg: string, ...args: any[]) {
    this.provider.trace ? this.provider.trace(msg, ...args) : this.provider.debug(msg, ...args)
  }

  fatal(msg: string, ...args: any[]) {
    this.provider.fatal ? this.provider.fatal(msg, ...args) : this.provider.error(msg, ...args)
  }
}

/** Shorthand for Logger.for(name) */
export function createLogger(name: string): Logger {
  return Logger.for(name)
}
