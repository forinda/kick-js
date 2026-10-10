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
  /**
   * Return a child provider scoped to the given component name. `bindings`
   * may also carry fields from `logger.child({ ... })` (a request id, a job
   * name) — a provider that ignores them keeps working as before.
   */
  child(bindings: { component: string; [field: string]: unknown }): LoggerProvider
}

// ── Log levels ─────────────────────────────────────────────────────────

/** Severity ordering — a message prints only when its rank ≥ the threshold. */
const LEVEL_RANK: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
}

/**
 * Resolve the active threshold rank from `LOG_LEVEL` (default `info`).
 * Read per-call so a late `process.env.LOG_LEVEL` assignment still
 * takes effect. An unrecognised value falls back to `info`.
 */
function thresholdRank(): number {
  // `process` is guarded because this module is reachable from the
  // edge-safe web pipeline (`@forinda/kickjs/web`), where strict runtimes
  // expose no `process` global at all. The colour probe below already
  // guarded; this one did not, so merely importing the logger could throw
  // on such a runtime.
  const level = (
    (typeof process !== 'undefined' ? process.env?.LOG_LEVEL : undefined) ?? 'info'
  ).toLowerCase()
  return LEVEL_RANK[level] ?? LEVEL_RANK.info
}

/** `LOG_FORMAT=json` switches the default provider to one JSON object per line. */
function jsonFormat(): boolean {
  return (
    (typeof process !== 'undefined' ? process.env?.LOG_FORMAT : undefined)?.toLowerCase() === 'json'
  )
}

/** A plain `{ ... }` object — merged into a JSON line as fields. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * An error as a JSON field — `type`, `message`, `stack`, own enumerable
 * properties (a driver's `code`), and its `cause` chain, depth-capped and
 * cycle-guarded like {@link describeError}.
 */
export function serializeError(err: unknown, depth = 4, seen = new Set<unknown>()): unknown {
  if (!(err instanceof Error)) return err
  if (seen.has(err) || depth <= 0) return '[circular cause]'
  seen.add(err)
  const out: Record<string, unknown> = { type: err.name, message: err.message, stack: err.stack }
  for (const [key, value] of Object.entries(err)) if (!(key in out)) out[key] = value
  const cause = (err as { cause?: unknown }).cause
  if (cause !== undefined) out.cause = serializeError(cause, depth - 1, seen)
  return out
}

/**
 * Fill printf-style placeholders the way `console.log` does (`%s %d %i %f
 * %j %o %O`, `%%`), then append what's left — so `log.info('hi %s', name)`
 * reads the same in JSON as on a terminal.
 */
function formatMessage(msg: string, args: unknown[]): string {
  let i = 0
  const filled = msg.replace(/%[sdifjoO%]/g, (token) => {
    if (token === '%%') return '%'
    if (i >= args.length) return token
    const value = args[i++]
    if (token === '%d' || token === '%i') return String(Math.trunc(Number(value)))
    if (token === '%f') return String(Number(value))
    if (token === '%s') return typeof value === 'string' ? value : safeStringify(value)
    return safeStringify(value)
  })
  const rest = args.slice(i).map((a) => (typeof a === 'string' ? a : safeStringify(a)))
  return rest.length ? `${filled} ${rest.join(' ')}` : filled
}

/**
 * One JSON log line, field-compatible with pino (`level` 10–60, `time` in
 * epoch ms, `msg`) so `pino-pretty` and log shippers read it as-is. Trailing
 * plain objects become fields, an `Error` becomes `err`, and anything else
 * fills the message's placeholders or is appended to it.
 */
export function jsonLine(
  level: keyof typeof LEVEL_RANK,
  component: string,
  bindings: Record<string, unknown>,
  msg: string,
  args: unknown[],
): string {
  const fields: Record<string, unknown> = {}
  const rest: unknown[] = []
  for (const arg of args) {
    if (arg instanceof Error && fields.err === undefined) fields.err = serializeError(arg)
    else if (isPlainObject(arg)) Object.assign(fields, arg)
    else rest.push(arg)
  }
  const line = {
    level: LEVEL_RANK[level],
    time: Date.now(),
    ...(component ? { component } : {}),
    ...bindings,
    ...fields,
    msg: formatMessage(msg, rest),
  }
  try {
    return JSON.stringify(line, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    )
  } catch {
    // A circular field: keep the line, drop what can't be written.
    return JSON.stringify({ level: line.level, time: line.time, component, msg: line.msg })
  }
}

// ── ConsoleLoggerProvider (default) ────────────────────────────────────

/**
 * Default provider — emits through `console.*` methods. Zero deps.
 *
 * Respects the `LOG_LEVEL` env var (default `info`): messages below the
 * threshold are dropped, so the verbose startup detail (the route table,
 * DI wiring, HMR ticks — all `debug`) stays quiet by default and only
 * appears with `LOG_LEVEL=debug`. `error`/`fatal` always print unless
 * `LOG_LEVEL=silent`.
 *
 * `LOG_FORMAT=json` writes one pino-compatible JSON object per line instead
 * (all levels through `console.log`, so one stream carries them): fields
 * from `logger.child({ ... })` and from trailing plain-object arguments, and
 * an `Error` argument as `err` with its stack and `cause` chain. The default
 * text output is unchanged.
 *
 * Swap it for pino, winston, bunyan, or anything else by implementing
 * the `LoggerProvider` interface and calling `Logger.setProvider()`
 * before `bootstrap()`.
 */
export class ConsoleLoggerProvider implements LoggerProvider {
  private prefix: string
  private useColor: boolean
  /** Fields from `logger.child({ ... })` — written on JSON lines. */
  private bindings: Record<string, unknown>

  constructor(prefix?: string, bindings: Record<string, unknown> = {}) {
    this.prefix = prefix ?? ''
    this.bindings = bindings
    this.useColor =
      typeof process !== 'undefined' && process.stdout?.isTTY === true && !process.env.NO_COLOR
  }

  /** Write `msg` as a JSON line when `LOG_FORMAT=json`; returns whether it did. */
  private json(level: keyof typeof LEVEL_RANK, msg: string, args: unknown[]): boolean {
    if (!jsonFormat()) return false
    console.log(jsonLine(level, this.prefix, this.bindings, msg, args))
    return true
  }

  private fmt(level: string, color: string, msg: string): string {
    const tag = this.prefix ? `[${this.prefix}]` : ''
    if (this.useColor) {
      return `${color}${level}\x1b[0m ${tag ? `\x1b[36m${tag}\x1b[0m ` : ''}${msg}`
    }
    return `${level} ${tag ? `${tag} ` : ''}${msg}`
  }

  /** Should a message at `rank` print under the current `LOG_LEVEL`? */
  private enabled(rank: number): boolean {
    return rank >= thresholdRank()
  }

  info(msg: string, ...args: any[]) {
    if (!this.enabled(LEVEL_RANK.info) || this.json('info', msg, args)) return
    console.log(this.fmt('INFO', '\x1b[32m', msg), ...args)
  }
  warn(msg: string, ...args: any[]) {
    if (!this.enabled(LEVEL_RANK.warn) || this.json('warn', msg, args)) return
    console.warn(this.fmt('WARN', '\x1b[33m', msg), ...args)
  }
  error(msg: string, ...args: any[]) {
    if (!this.enabled(LEVEL_RANK.error) || this.json('error', msg, args)) return
    console.error(this.fmt('ERROR', '\x1b[31m', msg), ...args)
  }
  debug(msg: string, ...args: any[]) {
    if (!this.enabled(LEVEL_RANK.debug) || this.json('debug', msg, args)) return
    console.debug(this.fmt('DEBUG', '\x1b[90m', msg), ...args)
  }
  trace(msg: string, ...args: any[]) {
    if (!this.enabled(LEVEL_RANK.trace) || this.json('trace', msg, args)) return
    console.trace(this.fmt('TRACE', '\x1b[90m', msg), ...args)
  }
  fatal(msg: string, ...args: any[]) {
    if (!this.enabled(LEVEL_RANK.fatal) || this.json('fatal', msg, args)) return
    console.error(this.fmt('FATAL', '\x1b[1m\x1b[31m', msg), ...args)
  }
  child(bindings: { component: string; [field: string]: unknown }): LoggerProvider {
    const { component, ...fields } = bindings
    return new ConsoleLoggerProvider(component, { ...this.bindings, ...fields })
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
  private _fields?: Record<string, unknown>

  /** Incremented on every setProvider/resetProvider so instances know to refresh */
  private static _providerVersion = 0

  constructor(name?: string, fields?: Record<string, unknown>) {
    this._name = name
    this._fields = fields
    this._providerVersion = Logger._providerVersion
    this._provider = this.derive()
  }

  /** The active provider's child for this logger's name and fields. */
  private derive(): LoggerProvider {
    if (!this._name && !this._fields) return activeProvider
    return activeProvider.child({ ...this._fields, component: this._name ?? '' })
  }

  /** Re-derive the provider if setProvider() was called since construction/last access */
  private get provider(): LoggerProvider {
    if (this._providerVersion !== Logger._providerVersion) {
      this._providerVersion = Logger._providerVersion
      this._provider = this.derive()
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
  child(name: string): Logger
  /**
   * Create a child logger carrying `fields` on every line it writes — a
   * request id, a job name. Keeps this logger's name and fields. Written as
   * JSON fields under `LOG_FORMAT=json`; the default text output is unchanged.
   */
  child(fields: Record<string, unknown>): Logger
  child(nameOrFields: string | Record<string, unknown>): Logger {
    if (typeof nameOrFields === 'string') return new Logger(nameOrFields)
    return new Logger(this._name, { ...this._fields, ...nameOrFields })
  }

  info(msg: string, ...args: any[]) {
    this.provider.info(msg, ...args)
  }

  warn(msg: string, ...args: any[]) {
    this.provider.warn(msg, ...args)
  }

  /** Pino-style error-first form — `log.error(err, 'what failed')`. */
  error(err: unknown, msg: string, ...args: any[]): void
  /** Message-first form — `log.error('what failed', detail)`. */
  error(msg: string, ...args: any[]): void
  /** Error alone — `log.error(err)`. */
  error(err: unknown): void
  error(msgOrErr: any, ...rest: any[]): void {
    if (typeof msgOrErr === 'string') {
      // Message-first. `rest` used to be dropped on the floor, so
      // `log.error('save failed', { id })` logged only the string.
      this.provider.error(msgOrErr, ...rest)
      return
    }

    // Error-first (the framework's own idiom at ~16 call sites). The
    // error object used to be discarded entirely — `provider.error(msg)`
    // with the error nowhere in the call — so every `log.error(err, msg)`
    // in the codebase logged a bare sentence with NO stack, no error
    // name, and no `cause` chain. That is what made an unexpected 500
    // undiagnosable from the logs: you got the message and nothing else.
    //
    // The error is now forwarded as a trailing argument, which is what
    // the msg-first `LoggerProvider` contract can carry. `console.error`
    // renders the full stack from it; a pino/winston adapter receives it
    // as structured extra.
    const [maybeMsg, ...extra] = rest
    if (typeof maybeMsg === 'string') {
      this.provider.error(maybeMsg, msgOrErr, ...extra)
    } else {
      // No message supplied — use the error's own summary as the line so
      // the log stays readable, and still pass the object for the stack.
      this.provider.error(describeError(msgOrErr), msgOrErr, ...rest)
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

/**
 * One-line summary of an unknown thrown value, including the error name
 * and — when present — the `cause` chain. ORM and driver errors routinely
 * wrap the useful detail in `cause`, so dropping it is how a 500 ends up
 * saying nothing actionable.
 *
 * Depth-capped and cycle-guarded: `cause` is attacker-influenced in some
 * stacks and self-referential chains do occur.
 */
export function describeError(err: unknown, maxDepth = 4): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = err
  for (let depth = 0; current !== undefined && current !== null && depth < maxDepth; depth++) {
    if (seen.has(current)) {
      parts.push('[circular cause]')
      break
    }
    seen.add(current)
    if (current instanceof Error) {
      parts.push(current.name ? `${current.name}: ${current.message}` : current.message)
      current = (current as { cause?: unknown }).cause
    } else {
      parts.push(typeof current === 'string' ? current : safeStringify(current))
      break
    }
  }
  return parts.length > 0 ? parts.join(' ← caused by ') : 'Unknown error'
}

/** `JSON.stringify` that never throws on circular / exotic values. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Shorthand for Logger.for(name) */
export function createLogger(name: string): Logger {
  return Logger.for(name)
}
