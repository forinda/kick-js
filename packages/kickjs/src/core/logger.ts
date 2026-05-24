// ── LoggerProvider interface ───────────────────────────────────────────

/**
 * Pluggable logger backend.
 *
 * Implement this interface to plug in any logging library (pino,
 * winston, bunyan, console, etc.). The framework only ever calls the
 * methods declared here — it doesn't know or care which logger is
 * underneath.
 *
 * Default: `ConsoleLoggerProvider` (zero runtime deps).
 *
 * @example
 * ```ts
 * import pino from 'pino'
 * import { Logger, type LoggerProvider } from '@forinda/kickjs'
 *
 * class PinoProvider implements LoggerProvider {
 *   constructor(private p = pino()) {}
 *   info(msg, ...args)  { this.p.info(msg, ...args) }
 *   warn(msg, ...args)  { this.p.warn(msg, ...args) }
 *   error(msg, ...args) { this.p.error(msg, ...args) }
 *   debug(msg, ...args) { this.p.debug(msg, ...args) }
 *   child({ component }) { return new PinoProvider(this.p.child({ component })) }
 * }
 *
 * Logger.setProvider(new PinoProvider())
 * ```
 *
 * See `docs/guide/logging.md` for Pino, Winston, and silent-logger recipes.
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

// ── ConsoleLoggerProvider (default) ────────────────────────────────────

/**
 * Default provider — emits through `console.*` methods. Zero deps.
 *
 * Swap it for pino, winston, bunyan, or anything else by implementing
 * the `LoggerProvider` interface and calling `Logger.setProvider()`
 * before `bootstrap()`.
 */
export class ConsoleLoggerProvider implements LoggerProvider {
  private prefix: string
  private useColor: boolean

  constructor(prefix?: string) {
    this.prefix = prefix ?? ''
    this.useColor =
      typeof process !== 'undefined' && process.stdout?.isTTY === true && !process.env.NO_COLOR
  }

  private fmt(level: string, color: string, msg: string): string {
    const tag = this.prefix ? `[${this.prefix}]` : ''
    if (this.useColor) {
      return `${color}${level}\x1b[0m ${tag ? `\x1b[36m${tag}\x1b[0m ` : ''}${msg}`
    }
    return `${level} ${tag ? `${tag} ` : ''}${msg}`
  }

  info(msg: string, ...args: any[]) {
    console.log(this.fmt('INFO', '\x1b[32m', msg), ...args)
  }
  warn(msg: string, ...args: any[]) {
    console.warn(this.fmt('WARN', '\x1b[33m', msg), ...args)
  }
  error(msg: string, ...args: any[]) {
    console.error(this.fmt('ERROR', '\x1b[31m', msg), ...args)
  }
  debug(msg: string, ...args: any[]) {
    console.debug(this.fmt('DEBUG', '\x1b[90m', msg), ...args)
  }
  trace(msg: string, ...args: any[]) {
    console.trace(this.fmt('TRACE', '\x1b[90m', msg), ...args)
  }
  fatal(msg: string, ...args: any[]) {
    console.error(this.fmt('FATAL', '\x1b[1m\x1b[31m', msg), ...args)
  }
  child(bindings: { component: string }): LoggerProvider {
    return new ConsoleLoggerProvider(bindings.component)
  }
}

// ── Active provider ────────────────────────────────────────────────────

let activeProvider: LoggerProvider = new ConsoleLoggerProvider()

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
 * // Pluggable backend — see docs/guide/logging.md
 * Logger.setProvider(new MyCustomProvider())
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
   * Logger.setProvider(new MyWinstonProvider())
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
   * Reset the provider back to the default `ConsoleLoggerProvider`.
   * Primarily intended for test teardown.
   */
  static resetProvider(): void {
    activeProvider = new ConsoleLoggerProvider()
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
    if (this.provider.trace) this.provider.trace(msg, ...args)
    else this.provider.debug(msg, ...args)
  }

  fatal(msg: string, ...args: any[]) {
    if (this.provider.fatal) this.provider.fatal(msg, ...args)
    else this.provider.error(msg, ...args)
  }
}

/** Shorthand for Logger.for(name) */
export function createLogger(name: string): Logger {
  return Logger.for(name)
}
