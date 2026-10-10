# Logging

KickJS ships with a small `LoggerProvider` interface and a zero-dep default that writes to `console`. The framework never imports a specific logging library — you bring your own when you want one.

## The default

Out of the box, `Logger.for('UserService').info('User created')` calls `console.log('[UserService] User created')`. No setup, no extra deps, no `pino-pretty` to install. Works in Node, Bun, Deno, edge runtimes, anywhere `console.*` exists.

```ts
import { Logger } from '@forinda/kickjs'

const log = Logger.for('UserService')

log.info('User created', { id: 'usr_123' })
log.warn('Quota approaching')
log.error('DB unreachable', err) // message-first
log.error(err, 'DB unreachable') // error-first (pino style) — also supported
log.debug('Cache miss for key=%s', key)
```

`log.error` accepts both orders. The error object is always forwarded to the provider, so the stack survives either way — `console` prints it in full, and a pino/winston adapter receives it as the first vararg. When you write a custom provider, forward `...args`; dropping them drops your stack traces. Pino in particular reads extra arguments only as `%s` values, so its adapter has to move them into the object it logs — see the recipe below.

The default provider respects the `LOG_LEVEL` env var (default `info`): messages below the threshold are dropped, ordered `trace < debug < info < warn < error < fatal` (plus `silent`). So `debug`/`trace` calls — including the framework's verbose startup detail like the route table and DI wiring — stay quiet unless you run with `LOG_LEVEL=debug`. Custom providers (Pino, Winston, …) manage their own levels.

### Fields on every line

`child()` with an object returns a logger that carries those fields — a request id, a job name — on every line it writes. It keeps the parent's name and fields:

```ts
const log = Logger.for('Orders').child({ requestId: ctx.requestId })
log.info('Order placed', { orderId })
```

The default text output doesn't print child fields, so existing logs read exactly as before. They show up in JSON output and in providers that write them (pino below). `requestLogger()` uses this: its line is unchanged, and `method`, `path`, `status`, `ms` and `requestId` ride along as fields.

### JSON output

Set `LOG_FORMAT=json` to write one JSON object per line instead — what container platforms and log shippers expect. The lines use pino's field names (`level` 10–60, `time` in epoch ms, `msg`), so `pino-pretty` reads them as they are:

```json
{"level":30,"time":1791590400000,"component":"Orders","requestId":"req-1","orderId":42,"msg":"Order placed"}
{"level":50,"time":1791590400100,"component":"Orders","err":{"type":"Error","message":"save failed","stack":"…","cause":{"type":"Error","message":"connection refused"}},"msg":"could not save"}
```

- Trailing plain objects become fields; a call's own fields win over the child's.
- An `Error` argument becomes `err`: type, message, stack, its own properties (a driver's `code`), and the `cause` chain.
- `%s` / `%d` / `%j` placeholders are filled like `console.log` fills them; other values are appended to `msg`.
- Every level goes through `console.log` (stdout), so one stream carries the log. `LOG_LEVEL` applies as usual.

JSON is opt-in: without `LOG_FORMAT=json` nothing changes.

For most apps that's enough. When it isn't, plug in a real logger.

## The contract

```ts
export interface LoggerProvider {
  info(msg: string, ...args: any[]): void
  warn(msg: string, ...args: any[]): void
  error(msg: string, ...args: any[]): void
  debug(msg: string, ...args: any[]): void
  trace?(msg: string, ...args: any[]): void // optional — falls back to debug
  fatal?(msg: string, ...args: any[]): void // optional — falls back to error
  /** `bindings` may also carry fields from `logger.child({ ... })` */
  child(bindings: { component: string; [field: string]: unknown }): LoggerProvider
}
```

Implement this and pass it to `Logger.setProvider()` **before** `bootstrap()`. Every `Logger.for(name)` call after that uses your provider; the framework's internal logs do too. Use `Logger.resetProvider()` to revert to the console default (useful in tests).

```ts
import { Logger } from '@forinda/kickjs'
import { MyProvider } from './my-provider'

Logger.setProvider(new MyProvider())

// ... bootstrap() etc.
```

## Recipe: Pino

<PmCommand add="pino pino-pretty" />

```ts
import pino from 'pino'
import { Logger, type LoggerProvider } from '@forinda/kickjs'

const root = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', singleLine: true },
    },
  }),
})

/**
 * KickJS calls providers message-first — `error('save failed', err)` — but pino
 * only reads extra arguments as `%s` values and drops the rest. Move an Error to
 * `err` and plain objects into the logged object, or stacks and fields vanish.
 */
function toPino(msg: string, args: unknown[]): [Record<string, unknown>, string, ...unknown[]] {
  const fields: Record<string, unknown> = {}
  const rest: unknown[] = []
  for (const arg of args) {
    if (arg instanceof Error) fields.err = arg
    else if (arg && typeof arg === 'object' && !Array.isArray(arg)) Object.assign(fields, arg)
    else rest.push(arg)
  }
  return [fields, msg, ...rest]
}

class PinoProvider implements LoggerProvider {
  constructor(private p: pino.Logger = root) {}
  info(msg: string, ...args: unknown[]) {
    this.p.info(...toPino(msg, args))
  }
  warn(msg: string, ...args: unknown[]) {
    this.p.warn(...toPino(msg, args))
  }
  error(msg: string, ...args: unknown[]) {
    this.p.error(...toPino(msg, args))
  }
  debug(msg: string, ...args: unknown[]) {
    this.p.debug(...toPino(msg, args))
  }
  trace(msg: string, ...args: unknown[]) {
    this.p.trace(...toPino(msg, args))
  }
  fatal(msg: string, ...args: unknown[]) {
    this.p.fatal(...toPino(msg, args))
  }
  child(bindings: { component: string; [field: string]: unknown }) {
    return new PinoProvider(this.p.child(bindings))
  }
}

Logger.setProvider(new PinoProvider())
```

If you bundle with Vite/esbuild for production, mark pino as external — its worker-thread transport resolves `pino-pretty` at runtime:

```ts
// vite.config.ts
export default defineConfig({
  ssr: { external: ['pino', 'pino-pretty'] },
})
```

## Recipe: Winston

<PmCommand add="winston" />

```ts
import { format } from 'node:util'
import winston from 'winston'
import { Logger, type LoggerProvider } from '@forinda/kickjs'

const root = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
})

/**
 * Winston keeps only the first object argument, glues an Error's message onto
 * the line, and fills `%s` only with `format.splat()`. Hand it one finished
 * message and one object of fields instead.
 */
function toWinston(msg: string, args: unknown[]): [string, Record<string, unknown>] {
  const fields: Record<string, unknown> = {}
  const rest: unknown[] = []
  for (const arg of args) {
    if (arg instanceof Error)
      fields.err = { type: arg.name, message: arg.message, stack: arg.stack }
    else if (arg && typeof arg === 'object' && !Array.isArray(arg)) Object.assign(fields, arg)
    else rest.push(arg)
  }
  return [format(msg, ...rest), fields]
}

class WinstonProvider implements LoggerProvider {
  constructor(private w: winston.Logger = root) {}
  private write(level: string, msg: string, args: unknown[]) {
    const [message, fields] = toWinston(msg, args)
    this.w.log(level, message, fields)
  }
  info(msg: string, ...args: unknown[]) {
    this.write('info', msg, args)
  }
  warn(msg: string, ...args: unknown[]) {
    this.write('warn', msg, args)
  }
  error(msg: string, ...args: unknown[]) {
    this.write('error', msg, args)
  }
  debug(msg: string, ...args: unknown[]) {
    this.write('debug', msg, args)
  }
  child(bindings: { component: string; [field: string]: unknown }) {
    return new WinstonProvider(this.w.child(bindings))
  }
}

Logger.setProvider(new WinstonProvider())
```

## Where logs go

Every option above writes to stdout by default. On a container platform (Docker, Kubernetes, Fly, Render, Railway) that is usually right: the platform collects stdout and ships it on. Use `LOG_FORMAT=json` (or pino / winston's JSON) so whatever reads it gets fields, not sentences.

To send logs somewhere else as well — files, an errors-only file, a log service — let the logger library do it; the KickJS adapter stays the same.

**Pino** — one transport with several targets, each with its own level. `pino/file` ships with pino; it writes from a worker thread, so the request path never waits on disk:

```ts
const root = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  pino.transport({
    targets: [
      { target: 'pino/file', level: 'info', options: { destination: 1 } }, // stdout
      {
        target: 'pino/file',
        level: 'info',
        options: { destination: './logs/app.log', mkdir: true },
      },
      {
        target: 'pino/file',
        level: 'error',
        options: { destination: './logs/error.log', mkdir: true },
      },
    ],
  }),
)
```

Rotation and services are more targets: `pino-roll` (rotating files), `pino-loki`, `pino-datadog-transport`, `pino-elasticsearch`, … — install one and add `{ target: 'pino-roll', options: { … } }`.

**Winston** — one transport per destination, each with its own level. `Stream` takes any writable stream:

```ts
import { createWriteStream } from 'node:fs'

const root = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/app.log' }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.Stream({ stream: createWriteStream('logs/audit.log', { flags: 'a' }) }),
  ],
})
```

Rotation is `winston-daily-rotate-file`; services have their own transports (`winston-loki`, `@datadog/winston`, …).

**The built-in logger** writes only to stdout. For a file without another library, redirect it — `node dist/index.js >> logs/app.log` — and rotate with the system's `logrotate`, or pipe JSON lines into a shipper (Vector, Fluent Bit, the Datadog agent).

## Recipe: silent (tests, CLI scripts)

```ts
import { Logger, type LoggerProvider } from '@forinda/kickjs'

class SilentProvider implements LoggerProvider {
  info() {}
  warn() {}
  error() {}
  debug() {}
  child() {
    return this
  }
}

Logger.setProvider(new SilentProvider())
```

## Injectable usage

Inside services, prefer the static factory or the `@Autowired` injection:

```ts
import { Service, Autowired, Logger } from '@forinda/kickjs'

@Service()
export class UserService {
  @Autowired() private logger!: Logger

  async create(input: CreateUserInput) {
    this.logger.info('creating user', { email: input.email })
    // ...
  }
}
```

`@Autowired() private logger!: Logger` resolves a per-class logger named after the enclosing class. Equivalent to `Logger.for('UserService')` but auto-named.

## Component context

`child()` adds a component name. The default `ConsoleLoggerProvider` formats it as a `[Name]` prefix; pino, winston etc. attach it as a structured field. The contract is the same either way:

```ts
const root = Logger.for('OrderModule')
const child = root.child('PaymentService')
child.info('charged')
// Console default → "[PaymentService] charged"
// Pino → { component: 'PaymentService', msg: 'charged', ... }
```

## Why no first-party adapter packages?

We intentionally don't ship `@forinda/kickjs-logger-pino` or similar. Logger ecosystems move at their own pace, each has its own config surface, and the adapter glue is ~15 lines you can read at a glance. Owning the adapter in your own app means you control its version, its transports, its formatting — without waiting for a kickjs release when your logger of choice cuts a major.
