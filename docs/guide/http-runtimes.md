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
routes). `ctx.json` / `ctx.html` / `ctx.download` / `ctx.redirect` / `ctx.sse` /
`ctx.problem` write through a small response driver, so the same handler code
runs unchanged on every engine.

::: warning `ctx.redirect` takes the URL as given
It goes straight into the `Location` header. Never pass it a destination read from the
request unchecked: allow-list it, or accept only a same-site path (one leading `/`,
not `//`). Otherwise the route is an open redirect.
:::

## Fastify

Fastify ships as a **subpath** of the core package — there's no separate npm
package. Install the engine peers alongside `@forinda/kickjs`:

<PmCommand add="fastify @fastify/middie" />

```ts
import { fastifyRuntime } from '@forinda/kickjs/fastify'

export const app = await bootstrap({ modules, runtime: fastifyRuntime() })
```

What works on Fastify today: routing, JSON / HTML / `ctx.problem` responses,
connect-style middleware (the built-ins — `helmet`, `cors`, `requestId`,
`requestLogger`, … — plus your own, bridged via `@fastify/middie`),
request-scoped DI and context decorators (`ctx.set` / `ctx.get`), `X-Request-Id`
propagation, error / 404 handling, Server-Sent Events (`ctx.sse`), and file
uploads (`@FileUpload` → `ctx.file` / `ctx.files`, via `@fastify/multipart`).

Fastify's built-in pino logger is disabled (`logger: false`) so the kickjs
`requestLogger` stays the single log format across engines.

## h3

[h3](https://h3.dev) is the HTTP layer behind Nitro / Nuxt. It ships as a
subpath too:

<PmCommand add="h3" />

```ts
import { h3Runtime } from '@forinda/kickjs/h3'

export const app = await bootstrap({ modules, runtime: h3Runtime() })
```

The binding targets **h3 v1** (the stable, node-based surface).

Same surface as Fastify: routing, JSON / HTML, connect middleware (via h3's
`fromNodeMiddleware`), context decorators, errors / 404, SSE, body validation,
native body parsing, and file uploads (`@FileUpload` → `ctx.file` / `ctx.files`,
via h3's built-in `readMultipartFormData` — no driver to install).

## h3 v2 (web standards)

h3 v2 rebased on WHATWG `Request` / `Response` — KickJS supports it through a
**separate, additive runtime**, so v1 adopters are untouched:

<PmCommand add="h3@latest   # the v2 line" />

```ts
import { h3WebRuntime } from '@forinda/kickjs/h3-web'

export const app = await bootstrap({ modules, runtime: h3WebRuntime() })
```

Each runtime fail-fasts with guidance when the wrong h3 major is installed.
The v2 runtime shares its request pipeline with the
[`@forinda/kickjs/web` fetch entry](./edge-deployment.md), which is how the
same app deploys to Cloudflare Workers, Bun, and Deno. One caveat vs v1: no
Vite dev-server fall-through (h3 v2 owns the full request) — use the v1 h3
runtime or Express for Vite-integrated dev.

### Calling the app through `fetch`

After `app.setup()`, `app.getRuntimeApp()` is the h3 v2 app, and
`h3.fetch(new Request(...))` runs the full application — routes, 404 / 405, body
parsing, validation, the error handler, and every middleware `Application`
installs (request scope, helmet, request id, plugin and adapter middleware).
That is the shape a serverless function, Bun, or Deno uses.

Connect-style `(req, res, next)` middleware runs on both paths:

- **Behind a node server** (`bootstrap()`, `app.handle`) it gets the real node
  `req` / `res` through h3's `fromNodeHandler`, exactly as before.
- **Through `fetch`** there is no node request, so it gets a web-backed pair
  instead. `res.setHeader` / `getHeader` / `removeHeader`, `res.statusCode`,
  `res.status().json()`, `res.end()`, `writeHead` / `write`, `next()` /
  `next(err)` and the `finish` / `close` events all work; headers set before
  `next()` land on the final response whatever its status. What does not exist
  there: the socket (`req.socket`, `req.ip`), the raw request body stream, and
  Express-only additions (`req.cookies`, `req.path`, `res.cookie`). Middleware
  that needs those should read `req.headers` or move to a context decorator.

## Capability matrix

Some `ctx` features depend on the engine. Calling an unsupported one raises a
clear error rather than failing silently.

| Capability                     | Express     | Fastify                 | h3 (v1)                 | h3 v2 (`h3-web`)                                    |
| ------------------------------ | ----------- | ----------------------- | ----------------------- | --------------------------------------------------- |
| Routing + `ctx.json`           | ✅          | ✅                      | ✅                      | ✅                                                  |
| Connect middleware             | ✅          | ✅ (via middie)         | ✅ (fromNodeMiddleware) | ✅ ([node + fetch](#calling-the-app-through-fetch)) |
| Context decorators             | ✅          | ✅                      | ✅                      | ✅                                                  |
| Errors / 404                   | ✅          | ✅                      | ✅                      | ✅                                                  |
| Server-Sent Events             | ✅          | ✅                      | ✅                      | ✅ (web streams)                                    |
| Validation                     | ✅          | ✅                      | ✅                      | ✅                                                  |
| `ctx.render` (views)           | ✅          | ❌ (no view engine)     | ❌ (no view engine)     | ❌ (no view engine)                                 |
| File uploads (`ctx.file`)      | ✅ (multer) | ✅ (@fastify/multipart) | ✅ (native multipart)   | ✅ (web `FormData`)                                 |
| File download (`ctx.download`) | ✅          | ✅                      | ✅                      | ✅                                                  |
| Edge / Bun / Deno deploy       | ❌          | ❌                      | ❌                      | ✅ (via [`/web`](./edge-deployment.md))             |

## The engine-native escape hatch

For genuinely engine-specific needs, the raw app and request/response are still
reachable:

- `AdapterContext.app` / `app.getRuntimeApp()` — the engine-native app instance.
- `ctx.req` / `ctx.res` — the engine-native request / response.

Check the helper list first. Sending a generated file is the usual reason people
reach past `ctx.*`, and it has a helper —
[`ctx.download(buffer, filename, type?)`](./controllers.md#returning-a-generated-file)
— which works on every runtime. `ctx.res.setHeader()` + `ctx.res.end()` compiles
on Express and breaks on the other two.

Under the default Express runtime these are typed as Express's `Application`,
`Request`, and `Response`. The types follow the active runtime via the
`ActiveRuntime` registry: set `runtime: 'fastify'` (or `'h3'`) in `kick.config.ts`
and the `kick/runtime` typegen emits a `KickRuntimeRegister` augmentation that
retypes them to that engine — Fastify's `FastifyInstance` / `FastifyRequest` /
`FastifyReply`, or h3's `App` / `H3Event`.

## Writing a custom runtime

A runtime implements the `HttpRuntime` contract (`createApp`, `nodeHandler`,
`mountRoutes`, `useConnect`, `serveStatic`, `setNotFound`, `setErrorHandler`,
`capabilities`). `expressRuntime()` is the reference implementation; the Fastify
runtime is ~250 lines over the same contract. See the
[design spec](../http/spec-http-runtimes.md) for the full contract and rationale.
