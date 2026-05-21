# Logging

KickJS ships with a small `LoggerProvider` interface and a zero-dep default that writes to `console`. The framework never imports a specific logging library — you bring your own when you want one.

## The default

Out of the box, `Logger.for('UserService').info('User created')` calls `console.log('[UserService] User created')`. No setup, no extra deps, no `pino-pretty` to install. Works in Node, Bun, Deno, edge runtimes, anywhere `console.*` exists.

```ts
import { Logger } from '@forinda/kickjs'

const log = Logger.for('UserService')

log.info('User created', { id: 'usr_123' })
log.warn('Quota approaching')
log.error('DB unreachable', err)
log.debug('Cache miss for key=%s', key)
```

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
  child(bindings: { component: string }): LoggerProvider
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

```bash
pnpm add pino pino-pretty
```

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

class PinoProvider implements LoggerProvider {
  constructor(private p: pino.Logger = root) {}
  info(msg: string, ...args: any[]) {
    this.p.info(msg, ...args)
  }
  warn(msg: string, ...args: any[]) {
    this.p.warn(msg, ...args)
  }
  error(msg: string, ...args: any[]) {
    this.p.error(msg, ...args)
  }
  debug(msg: string, ...args: any[]) {
    this.p.debug(msg, ...args)
  }
  trace(msg: string, ...args: any[]) {
    this.p.trace(msg, ...args)
  }
  fatal(msg: string, ...args: any[]) {
    this.p.fatal(msg, ...args)
  }
  child({ component }: { component: string }) {
    return new PinoProvider(this.p.child({ component }))
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

```bash
pnpm add winston
```

```ts
import winston from 'winston'
import { Logger, type LoggerProvider } from '@forinda/kickjs'

const root = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
})

class WinstonProvider implements LoggerProvider {
  constructor(private w: winston.Logger = root) {}
  info(msg: string, ...args: any[]) {
    this.w.info(msg, ...args)
  }
  warn(msg: string, ...args: any[]) {
    this.w.warn(msg, ...args)
  }
  error(msg: string, ...args: any[]) {
    this.w.error(msg, ...args)
  }
  debug(msg: string, ...args: any[]) {
    this.w.debug(msg, ...args)
  }
  child({ component }: { component: string }) {
    return new WinstonProvider(this.w.child({ component }))
  }
}

Logger.setProvider(new WinstonProvider())
```

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

## Request context

When the HTTP layer is active, it wires `Logger._contextProvider` to surface the current `requestId` (and any other request-scoped fields) on every log call. You don't have to do anything — it Just Works once `bootstrap()` runs. If you write a custom provider, the framework's runtime hook is read by `Logger`, not by your provider, so there's nothing to integrate on your side.

## Why no first-party adapter packages?

We intentionally don't ship `@forinda/kickjs-logger-pino` or similar. Logger ecosystems move at their own pace, each has its own config surface, and the adapter glue is ~15 lines you can read at a glance. Owning the adapter in your own app means you control its version, its transports, its formatting — without waiting for a kickjs release when your logger of choice cuts a major.
