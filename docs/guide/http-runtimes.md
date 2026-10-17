# HTTP Runtimes

KickJS runs on **Express by default**, but the HTTP engine is a bootstrap-time
choice. Controllers, modules, context decorators, DI, and the dev loop don't
change when you swap engines — the runtime is an infrastructure decision, not an
application rewrite.

```ts
import { bootstrap } from '@forinda/kickjs'

// Express — the default. Needs `express` installed (kick new adds it).
export const app = await bootstrap({ modules })
```

```ts
import { bootstrap } from '@forinda/kickjs'
import { fastifyRuntime } from '@forinda/kickjs/fastify'

// Opt in to Fastify — same modules, same controllers.
export const app = await bootstrap({ modules, runtime: fastifyRuntime() })
```

An app on Fastify or h3 doesn't need `express` installed. To use
`buildRoutes()`, `materializeRouter()` or `expressRuntime()` on a plain
`express()` app — in a test, say — import them from `@forinda/kickjs/express`.

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

<PmCommand add="h3@^2" />

```ts
import { h3Runtime } from '@forinda/kickjs/h3'

export const app = await bootstrap({ modules, runtime: h3Runtime() })
```

Same surface as Fastify: routing, JSON / HTML, connect middleware, context
decorators, errors / 404, SSE, body validation, native body parsing, and file
uploads (`@FileUpload` → `ctx.file` / `ctx.files`, from the request's
`FormData` — no driver to install).

h3 v2 is built on WHATWG `Request` / `Response`, and the runtime shares its
request pipeline with the [`@forinda/kickjs/web` fetch entry](./edge-deployment.md),
which is how the same app deploys to Cloudflare Workers, Bun, and Deno. Under
`kick dev` and behind a host server it hands unmatched requests back unless
`notFoundFallthrough: false`.

If the app's `h3` is not the one KickJS resolves (a linked checkout, a
bundler), pass it in: `h3Runtime({ h3: await import('h3') })`.

### Upgrading from h3 v1

The runtime needs h3 v2; on v1 it fails at boot with the upgrade command, and
`kick doctor` flags it. Run `pnpm add h3@^2`. Apps that only use KickJS APIs
need no code change. Code that reaches into the engine (`getRuntimeApp()`,
`ctx.req` as an `H3Event`, h3 utilities called on it) follows
[h3's migration guide](https://h3.dev/migration). `h3WebRuntime()` from
`@forinda/kickjs/h3-web` is a deprecated alias of `h3Runtime()`.

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

## Same behaviour on every engine

Swapping the engine must not change what clients see. These hold on Express, Fastify, h3 and the [web entry](./edge-deployment.md) alike, and a conformance suite runs them against each:

|                    | Behaviour                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Errors             | RFC 9457 problem details from one handler; a 500 carries `requestId`.                       |
| Unmatched requests | `404` problem details; a known path with the wrong method is `405` with `Allow`.            |
| Route params       | Percent-decoded (`/users/a%20b` → `'a b'`); a malformed escape is `400`.                    |
| Body size          | `jsonLimit` (default `'1mb'`) applies; a larger body is `413`.                              |
| Form bodies        | A repeated field becomes an array (`tag=a&tag=b` → `['a', 'b']`).                           |
| Request id         | Every response carries `X-Request-Id`; an id already assigned wins over the inbound header. |
| `trustProxy`       | Express semantics: `true`, a hop count, an address list, or a `(ip, hop)` predicate.        |
| Cookies            | Setting several cookies keeps them all.                                                     |
| Shutdown           | The engine is closed too — Fastify's `onClose` hooks run.                                   |

One difference remains: a handler that neither writes a response nor returns a value answers `404` on Fastify and h3, but on Express the request stays open — `ctx.render()` and raw `res` writes finish after the handler returns there, so Express cannot tell "done" from "still writing". Return a value or call a `ctx` response method.

## Capability matrix

Some `ctx` features depend on the engine. Calling an unsupported one raises a
clear error rather than failing silently.

| Capability                     | Express      | Fastify                 | h3                                                  |
| ------------------------------ | ------------ | ----------------------- | --------------------------------------------------- |
| Routing + `ctx.json`           | ✅           | ✅                      | ✅                                                  |
| Connect middleware             | ✅           | ✅ (via middie)         | ✅ ([node + fetch](#calling-the-app-through-fetch)) |
| Context decorators             | ✅           | ✅                      | ✅                                                  |
| Errors / 404                   | ✅           | ✅                      | ✅                                                  |
| Server-Sent Events             | ✅           | ✅                      | ✅                                                  |
| Validation                     | ✅           | ✅                      | ✅                                                  |
| `ctx.render` (views)           | ✅           | ❌ (no view engine)     | ❌ (no view engine)                                 |
| File uploads (`ctx.file`)      | ✅ (multer)  | ✅ (@fastify/multipart) | ✅ (web `FormData`)                                 |
| File download (`ctx.download`) | ✅           | ✅                      | ✅                                                  |
| Edge / Bun / Deno deploy       | ❌           | ❌                      | ✅ (via [`/web`](./edge-deployment.md))             |
| HTTP/2 (`server.http2`)        | ❌ (KICK007) | ✅                      | ✅ (node); the platform's server on edge            |

## HTTPS and HTTP/2

In production, `start()` creates a plain `http.Server`. Pass `server` to serve
TLS directly, and optionally HTTP/2:

```ts
import { readFileSync } from 'node:fs'
import { bootstrap } from '@forinda/kickjs'
import { fastifyRuntime } from '@forinda/kickjs/fastify'

export const app = await bootstrap({
  modules,
  runtime: fastifyRuntime(),
  server: {
    tls: { key: readFileSync('key.pem'), cert: readFileSync('cert.pem') },
    http2: true,
  },
})
```

| `server`               | Node server                                        | Engines     |
| ---------------------- | -------------------------------------------------- | ----------- |
| omitted                | `http.createServer`                                | all         |
| `{ tls }`              | `https.createServer`                               | all         |
| `{ tls, http2: true }` | `http2.createSecureServer` with `allowHTTP1: true` | Fastify, h3 |

- `tls` takes any Node TLS option (`key`, `cert`, `ca`, `pfx`, `passphrase`, …). It must identify the server — `key` + `cert`, `pfx`, `SNICallback`, or `pskCallback` — and is loaded once at boot, so a missing cert, an unreadable PEM, or a key that does not match its cert fails with `KICK009` instead of on every handshake.
- With `http2`, clients that negotiate `h2` get HTTP/2 and everything else —
  including WebSocket handshakes — falls back to HTTP/1.1 on the same port, so
  `@forinda/kickjs-ws`, Socket.IO, and the DevTools bus keep working. Adapters
  receive the server in `afterStart({ server })`, typed `KickServer`.
- **Express cannot serve HTTP/2** — it does not run on Node's HTTP/2
  compatibility layer — so `http2: true` on the Express runtime fails at boot
  with `KICK007`. `http2` without `tls` fails with `KICK008`: browsers only
  speak HTTP/2 over TLS, and cleartext HTTP/2 (h2c) is not offered.
- Ignored in dev mode, where Vite owns the server.

Most deployments terminate TLS and HTTP/2 at a proxy or platform (nginx, Caddy,
a load balancer, Cloudflare, Vercel) and send HTTP/1.1 to the app — those need
none of this. It is for apps exposed directly, or local HTTPS. HTTP/3 is not
offered: Node has no stable QUIC yet.

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

`kick typegen` types them for the `runtime` in `kick.config.ts` (Express when
unset): Express's `Application` / `Request` / `Response`, Fastify's
`FastifyInstance` / `FastifyRequest` / `FastifyReply`, or h3's.

Middleware takes the same `(req, res, next)` types on every runtime
(`ConnectHandler`, `ConnectErrorHandler`), and Express middleware —
`express.json()`, `cors()` — fits them.

## Writing a custom runtime

A runtime implements the `HttpRuntime` contract (`createApp`, `nodeHandler`,
`mountRoutes`, `useConnect`, `serveStatic`, `setNotFound`, `setErrorHandler`,
`capabilities`). `expressRuntime()` is the reference implementation; the Fastify
runtime is ~250 lines over the same contract. Optionally, `load()` runs once
before `createApp()` to import the engine, and `bodyParsers({ limit })` returns
the body parsers for an engine that doesn't parse bodies itself.
