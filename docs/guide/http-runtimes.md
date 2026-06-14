# HTTP Runtimes

KickJS runs on **Express by default**, but the HTTP engine is a bootstrap-time
choice. Controllers, modules, context decorators, DI, and the dev loop don't
change when you swap engines — the runtime is an infrastructure decision, not an
application rewrite.

```ts
import { bootstrap } from '@forinda/kickjs'

// Express — the zero-config default. Nothing to install or configure.
export const app = await bootstrap({ modules })
```

```ts
import { bootstrap } from '@forinda/kickjs'
import { fastifyRuntime } from '@forinda/kickjs/fastify'

// Opt in to Fastify — same modules, same controllers.
export const app = await bootstrap({ modules, runtime: fastifyRuntime() })
```

## Why it works

Your controllers already speak `RequestContext`, not Express:

```ts
@Controller()
class UsersController {
  @Get('/:id')
  get(ctx: RequestContext) {
    ctx.json({ id: ctx.params.id }) // engine-agnostic — works on any runtime
  }
}
```

KickJS turns decorators into an engine-neutral **route table**, and each runtime
materializes that table onto its own router (real Express routes, real Fastify
routes). `ctx.json` / `ctx.html` / `ctx.sse` / `ctx.problem` write through a
small response driver, so the same handler code runs unchanged on every engine.

## Fastify

Fastify ships as a **subpath** of the core package — there's no separate npm
package. Install the engine peers alongside `@forinda/kickjs`:

```bash
pnpm add fastify @fastify/middie
```

```ts
import { fastifyRuntime } from '@forinda/kickjs/fastify'

export const app = await bootstrap({ modules, runtime: fastifyRuntime() })
```

What works on Fastify today: routing, JSON / HTML / `ctx.problem` responses,
connect-style middleware (the built-ins — `helmet`, `cors`, `requestId`,
`requestLogger`, … — plus your own, bridged via `@fastify/middie`),
request-scoped DI and context decorators (`ctx.set` / `ctx.get`), `X-Request-Id`
propagation, error / 404 handling, and Server-Sent Events (`ctx.sse`).

Fastify's built-in pino logger is disabled (`logger: false`) so the kickjs
`requestLogger` stays the single log format across engines.

## Capability matrix

Some `ctx` features depend on the engine. Calling an unsupported one raises a
clear error rather than failing silently.

| Capability                | Express | Fastify             |
| ------------------------- | ------- | ------------------- |
| Routing + `ctx.json`      | ✅      | ✅                  |
| Connect middleware        | ✅      | ✅ (via middie)     |
| Context decorators        | ✅      | ✅                  |
| Errors / 404              | ✅      | ✅                  |
| Server-Sent Events        | ✅      | ✅                  |
| `ctx.render` (views)      | ✅      | ❌ (no view engine) |
| File uploads (`ctx.file`) | ✅      | ⏳ (planned)        |

## The engine-native escape hatch

For genuinely engine-specific needs, the raw app and request/response are still
reachable:

- `AdapterContext.app` / `app.getRuntimeApp()` — the engine-native app instance.
- `ctx.req` / `ctx.res` — the engine-native request / response.

Under the default Express runtime these are typed as Express's `Application`,
`Request`, and `Response`. The types follow the active runtime via the
`ActiveRuntime` registry, so a future `kick/runtime` typegen step can retype them
to Fastify's `FastifyInstance` / `FastifyRequest` / `FastifyReply`.

## Writing a custom runtime

A runtime implements the `HttpRuntime` contract (`createApp`, `nodeHandler`,
`mountRoutes`, `useConnect`, `serveStatic`, `setNotFound`, `setErrorHandler`,
`capabilities`). `expressRuntime()` is the reference implementation; the Fastify
runtime is ~250 lines over the same contract. See the
[design spec](../http/spec-http-runtimes.md) for the full contract and rationale.
