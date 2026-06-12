# Spec: Pluggable HTTP Runtimes (Express / Fastify / h3)

> Status: **DRAFT — design spec, no implementation yet.**
> Mirrors the `docs/db/` spec convention. Companion inventory: the
> coupling audit summarized in §2 (31 core coupling points + per-package
> downstream matrix, file:line refs in §2.3/§2.4).

## 1. Goal & non-goals

**Goal.** Let an adopter pick the HTTP engine at bootstrap:

```ts
// Express stays the zero-config default — nothing changes for existing apps.
export const app = await bootstrap({ modules })

// Opt in to Fastify or h3:
import { fastifyRuntime } from '@forinda/kickjs-fastify'
export const app = await bootstrap({ modules, runtime: fastifyRuntime() })

import { h3Runtime } from '@forinda/kickjs-h3'
export const app = await bootstrap({ modules, runtime: h3Runtime() })
```

Controllers, modules, context decorators, DI, typegen, and the dev loop
must not change. The runtime is an infrastructure choice, not an
application rewrite.

**Non-goals (this cycle).**

- No edge-runtime / serverless deployment story (h3 makes it _reachable_
  later; see §8).
- No performance-parity promise on day one — Fastify behind the runtime
  seam initially routes through the shared pipeline, not Fastify's
  schema-compiled serializers (see §7 Risks).
- No migration of the deprecated `@forinda/kickjs-auth` package (BYO auth
  already composes from `ctx`, which is runtime-neutral by design here).

## 2. Where Express actually lives today

Full audit: 31 coupling points in `packages/kickjs`, plus downstream.
The load-bearing observation: **the handler pipeline is already
`ctx`-based.** Controllers, contributors, and most built-in middleware
never touch Express APIs — they touch `RequestContext`. Express appears
in exactly three strata:

1. **The wrapper layer** — `router-builder.ts` wraps every ctx-handler in
   `(req: express.Request, res, next)` and registers it on an
   `express.Router` (`router-builder.ts:62,118-184`).
2. **The `ctx` internals** — `RequestContext` stores raw `req`/`res` and
   implements `json()`/`html()`/`sse()`/`render()`/`file` over Express
   response methods (`context.ts:256-754`).
3. **The public type surface** — `AdapterContext.app: Express`
   (`core/adapter.ts:80`), `AdapterMiddleware.handler: RequestHandler`
   (`core/adapter.ts:54`), `ApplicationOptions.middlewares:
RequestHandler[]`, `ctx.req/ctx.res` Express-typed,
   `Express.Multer.File` on `ctx.file`.

### 2.1 Already runtime-neutral (verified)

- **Vite dev piping** needs only a node `(req, res, next?)` callable
  (`vite/dev-server.ts:134-174`) and a raw `http.Server` on
  `globalThis` — both satisfiable by all three engines.
- **Built-in middleware** (helmet, cors, csrf, rate-limit, request-id,
  request-logger, trace-context, session, validate): node-http
  primitives only (`setHeader`, `statusCode`, `headers`, `on('finish')`).
  Two strays: `req.originalUrl` (request-logger) and `req.ip`
  (rate-limit) — one-line normalizations.
- **`ctx.signal`**, request draining, graceful shutdown: stream events
  only.
- **`packages/ws`**: attaches to `http.Server` `upgrade` — zero coupling.
- **Query parsing**: `parseQuery(obj)` is a pure function; only the
  `req.query` read is runtime-supplied.

### 2.2 Hard couplings (the actual work)

| Surface                                                     | File:line                                       | Consumers                                                   |
| ----------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| Route registration emits `express.Router`                   | `kickjs/src/http/router-builder.ts:62,184`      | Application mount, swagger/devtools `app.use(path, router)` |
| `RequestContext` response helpers                           | `kickjs/src/http/context.ts:522-754`            | every controller                                            |
| `AdapterContext.app: Express`                               | `kickjs/src/core/adapter.ts:80`                 | swagger, devtools, mcp, queue adapters mount routes on it   |
| `AdapterMiddleware.handler: RequestHandler`                 | `kickjs/src/core/adapter.ts:54`                 | every adapter shipping middleware                           |
| `ApplicationOptions.middlewares` / `onNotFound` / `onError` | `kickjs/src/http/application.ts:38,101,239,257` | adopter bootstrap code (`express.json()` in every scaffold) |
| Multer (`ctx.file`, `upload()` middleware)                  | `context.ts:474-496`, `middleware/upload.ts`    | file-upload routes                                          |
| Views (`app.engine`, `res.render`)                          | `middleware/views.ts:62-95`, `context.ts:647`   | ViewAdapter users                                           |
| Error-handler 4-arity convention                            | `middleware/error-handler.ts:28`                | global error path                                           |

### 2.3 Downstream impact matrix

| Package                     | Verdict                                | Work                                                             |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| vite                        | connect-compat piping                  | None beyond runtime providing `nodeHandler()`                    |
| ws                          | transport-only                         | None                                                             |
| swagger                     | Router + `express.static`              | Migrate to mount facade (§4.4)                                   |
| devtools                    | Router + 26 endpoints + SSE + static   | Migrate to mount facade + ctx-handlers (largest downstream item) |
| mcp                         | `app.post/get/delete` (HTTP transport) | Mount facade (3 routes)                                          |
| queue                       | 2 DevTools panel routes                | Mount facade (trivial)                                           |
| testing                     | `getExpressApp()` + supertest          | Return node handler; deprecated alias kept                       |
| cli templates               | `express.json()` in scaffold           | Template emits runtime-neutral `bodyParser.json()` re-export     |
| auth (deprecated)           | type-only                              | None (frozen)                                                    |
| ai / db\* / schema / others | none                                   | None                                                             |

## 3. Three avenues considered

### Avenue A — Express-compat emulation on the new engines

Run Fastify with `@fastify/express` / `@fastify/middie` (officially
maintained for v5) or h3's node bridge, and feed them KickJS's existing
express-shaped pipeline unchanged.

- ✅ Smallest diff.
- ❌ Defeats the purpose: Fastify's router/serialization are bypassed, so
  adopters get Express semantics with extra layers — `@fastify/express`'s
  own README says not to use it long-term. No real h3 story (its v2 model
  is web-standard `Request`/`Response`, not connect emulation).
- **Verdict: rejected** as the architecture; `@fastify/middie` remains
  useful _inside_ the Fastify runtime adapter for adopter-supplied
  connect middleware (§5.2).

### Avenue B — `HttpRuntime` seam over the existing ctx pipeline ⭐ recommended

Make the runtime an injected driver. KickJS keeps owning: decorators →
**RouteTable** (plain data), contributor pipeline, `RequestContext`
surface, error mapping. The runtime owns: app/server creation, route
materialization, body parsing, and a small `RuntimeResponse` driver that
`ctx` helpers call instead of Express methods.

- ✅ Controllers/contributors untouched; Express remains default with
  zero behavior change; per-runtime native routing (Fastify routes are
  _real_ Fastify routes — its router, its 404, its onRequest hooks).
- ✅ The audit shows the pipeline is one wrapper-layer away from this
  already.
- ❌ Public-type churn on the adapter contract + bootstrap options
  (mitigated via aliases + one deprecation cycle, §6).

### Avenue C — Web-standard core (Request/Response), engines as bridges

Rebuild `ctx` over WHATWG `Request`/`Response` (h3 v2's model; srvx
bridges Node at ~97% native throughput per h3's published numbers).

- ✅ Most future-proof: h3 becomes the _thin_ runtime, edge/Bun/Deno fall
  out for free.
- ❌ Biggest break: streaming/SSE rewrite, multer gone, express
  middleware option gone, `ctx.res` semantics change for every adopter.
  h3 v2 is also still in beta.
- **Verdict: deferred, but Avenue B is designed so the
  `RuntimeRequest`/`RuntimeResponse` drivers CAN later be implemented
  over web standards** — C becomes an additional runtime + an internal
  driver swap, not a second migration.

## 4. Design (Avenue B)

### 4.1 The `HttpRuntime` contract (new: `kickjs/src/http/runtime.ts`)

```ts
export interface HttpRuntime<TApp = unknown> {
  readonly name: 'express' | 'fastify' | 'h3' | (string & {})

  /** Create the engine app. Called once per Application (and per HMR rebuild). */
  createApp(options: RuntimeAppOptions): TApp

  /**
   * Node-compatible request listener. THE transport contract:
   * `http.createServer(handler)` in prod, Vite post-middleware in dev.
   * MUST invoke `next` (when given) instead of 404-ing if no route
   * matched — the Vite chain depends on fall-through.
   */
  nodeHandler(
    app: TApp,
  ): (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => void

  /** Materialize the framework-built route table on the engine. */
  mountRoutes(app: TApp, table: RouteTable): void

  /** Mount a connect-style middleware (built-ins + adopter express middleware). */
  useConnect(
    app: TApp,
    mw: ConnectMiddleware,
    opts?: { path?: MiddlewarePath; phase?: MiddlewarePhase },
  ): void

  /** Static directory serving (swagger-ui assets, devtools SPA). */
  serveStatic(app: TApp, path: string, dir: string): void

  /** Bind the engine's request/response into runtime drivers for ctx. */
  bind(req: unknown, res: unknown): RuntimeBinding

  /** Terminal handlers — runtime adapts arity/registration conventions. */
  setNotFound(app: TApp, handler: CtxHandler): void
  setErrorHandler(app: TApp, handler: (err: unknown, ctx: RequestContext) => void): void

  /** Optional capabilities — absence = feature errors with a clear message. */
  readonly capabilities: {
    render?: boolean // express: true (view engines); fastify/h3: false initially
    uploads?: boolean // all three eventually; different backends
    connectMiddleware: boolean // express/fastify(middie): true; h3: best-effort
  }
}
```

### 4.2 `RouteTable` — decorators stop emitting `express.Router`

`buildRoutes()` (router-builder.ts) becomes a pure transform:
decorator metadata → `RouteTable`:

```ts
export interface RouteEntry {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string // ':param' syntax — all three engines accept it
  pipeline: CtxHandler[] // contributors (topo-sorted) + route middleware + handler
  meta: RouteMeta // schema refs, upload config, version — for swagger/typegen
}
export type RouteTable = { mountPath: string; routes: RouteEntry[] }[]
export type CtxHandler = (ctx: RequestContext) => unknown | Promise<unknown>
```

Everything currently wrapped per-handler in express `(req,res,next)`
closures (router-builder.ts:118-183) is ALREADY a ctx pipeline — this
change deletes the express wrapper rather than adding abstraction.
Path syntax: `:param` is the portable subset (Express 5 / Fastify /
h3 all support it); regex paths become an Express-capability.

### 4.3 `RequestContext` over runtime drivers

`ctx` keeps its exact public method surface. Internals re-target:

```ts
interface RuntimeRequest {
  method: string
  url: string
  path: string
  headers: IncomingHttpHeaders
  params: Record<string, string>
  query: Record<string, unknown>
  body: unknown
  ip: string | undefined
  raw: unknown // engine-native escape hatch
  once(event: 'close', cb: () => void): void
}
interface RuntimeResponse {
  status(code: number): this
  header(name: string, value: string | string[]): this
  json(data: unknown): void
  send(data: string | Buffer): void
  // SSE/streaming primitive — enough for ctx.sse() and devtools streams:
  writeHead(code: number, headers: Record<string, string>): void
  write(chunk: string | Buffer): boolean
  end(): void
  readonly headersSent: boolean
  raw: unknown
}
```

- `ctx.req` / `ctx.res` remain — typed as `RuntimeRequest`/`RuntimeResponse`
  with `.raw` for engine natives. **Breaking-ish**: adopters doing
  `ctx.res.sendFile(...)` move to `ctx.res.raw`. One codemod-able pattern.
- `ctx.file` → neutral `UploadedFile` interface (field/originalname/
  mimetype/size/buffer|path). Express runtime backs it with multer;
  Fastify with `@fastify/multipart`; h3 with `readFormData`.
- `ctx.render()` → throws `RuntimeCapabilityError('render')` on runtimes
  without `capabilities.render`.
- `ctx.sse()` already writes via `writeHead/write/end` — maps directly.

### 4.4 Adapter contract — the mount facade

`AdapterContext` changes from `app: Express` to:

```ts
export interface AdapterContext {
  http: AdapterHttp // NEW — the supported surface
  app: unknown // engine-native escape hatch (was: Express)
  container: Container
  server?: http.Server
  // …
}
export interface AdapterHttp {
  route(method: HttpMethod, path: string, handler: CtxHandler): void
  mount(prefix: string, routes: RouteEntry[]): void
  serveStatic(prefix: string, dir: string): void
  use(mw: ConnectMiddleware, opts?: { path?: MiddlewarePath; phase?: MiddlewarePhase }): void
}
```

First-party migrations (mechanical — all their handlers are
`(req,res) => res.json(...)` one-liners that become ctx-handlers):

- **swagger** (`swagger.adapter.ts:173-278`): 3 routes + 1 static dir.
- **devtools** (`adapter.ts:456-919`): 26 routes + SSE (via `ctx.sse`) +
  static SPA. Largest item; pure transcription.
- **mcp** (`mcp.adapter.ts:372-391`): 3 routes.
- **queue** (`queue.adapter.ts:135-154`): 2 routes.

`AdapterMiddleware.handler` keeps the connect signature (it IS the
portable middleware format — Fastify consumes it via middie, h3 via its
node bridge), renamed type `ConnectMiddleware` with `RequestHandler`
kept as a deprecated alias.

### 4.5 Bootstrap & dev loop

- `ApplicationOptions.runtime?: HttpRuntime` — default
  `expressRuntime()` (lives in core; express stays a peer dep of
  `@forinda/kickjs`).
- `Application` replaces its 12 `this.app.use(...)` sites with
  `runtime.useConnect(...)` and `http.createServer(this.app)` with
  `http.createServer(runtime.nodeHandler(app))`.
- **Vite dev**: `dev-server.ts:156` calls `expressApp.handle(req,res,next)`
  today → calls `app.handle(req,res,next)` where `Application.handle`
  already exists (`application.ts:385`) and simply delegates to
  `runtime.nodeHandler`. The Fastify runtime implements next-fall-through
  by setting a notFound handler that invokes a per-request continuation
  (stashed on the request before dispatch); h3 equivalently from its
  node adapter. **No vite-package changes needed.**
- `getExpressApp()` → deprecated alias for `getRuntimeApp(): unknown`;
  returns the engine app under any runtime (testing keeps working —
  supertest accepts any node handler: `request(app.nodeHandler())`).

### 4.6 New packages

| Package                   | Contents                                            | Deps                                                             |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| (core) `@forinda/kickjs`  | `HttpRuntime` contract + `expressRuntime()` default | `express` peer (unchanged)                                       |
| `@forinda/kickjs-fastify` | `fastifyRuntime(opts?: FastifyServerOptions)`       | `fastify` peer, `@fastify/middie`, `@fastify/multipart` optional |
| `@forinda/kickjs-h3`      | `h3Runtime()`                                       | `h3` peer (pin v2 once stable; v1 fallback path documented)      |

Naming follows the existing `@forinda/kickjs-<thing>` convention.

## 5. Per-engine notes

### 5.2 Fastify runtime

- App: `fastify({ ...opts })`; routes registered natively
  (`app.route({ method, url, handler })`) — handler builds the
  `RuntimeBinding` from `(request, reply)` and runs the ctx pipeline.
- `nodeHandler`: `await app.ready()` once, then `(req,res,next) =>` —
  unmatched routes fall through to `next` via notFound continuation.
- Connect middleware (built-ins + adopter Express middleware) via
  `@fastify/middie` (no 4-arity error middleware — error path goes
  through the runtime's `setErrorHandler` instead, which we control).
- `RuntimeResponse` over `reply` (`reply.code/header/send`); SSE via
  `reply.raw` (the underlying ServerResponse) — same primitive as today.
- Body parsing: Fastify-native (scaffold's `express.json()` becomes a
  no-op marker the runtime recognizes — see §6 template change).

### 5.3 h3 runtime

- v2 (beta, web-standard core, srvx node bridge) is the design target;
  the adapter shape works for v1 (`createApp`/`toNodeListener`) if v2
  stability slips.
- Routes via h3 router; `RuntimeBinding` over h3's event object; node
  `req/res` reachable in node mode for SSE/static.
- Connect middleware: h3 node-middleware bridge (`fromNodeHandler`-style);
  capability-flagged best-effort.
- This runtime is also the proving ground for the §8 web-standard driver.

## 6. Compatibility & migration

- **Default unchanged**: no `runtime` option → `expressRuntime()`,
  byte-equivalent behavior. All existing apps unaffected.
- **Type aliases, one deprecation cycle**: `RequestHandler` →
  `ConnectMiddleware`, `getExpressApp()` → `getRuntimeApp()`,
  `AdapterContext.app` stays present (typed `unknown`; Express adapters
  cast — a codemod `kick codemod adapter-http` rewrites first-party
  patterns).
- **Scaffold**: `express.json()` in templates → `bodyParser.json()`
  re-exported from `@forinda/kickjs` (express impl under the hood;
  recognized + replaced natively by other runtimes).
- **`ctx.req/ctx.res` raw access**: the only adopter-visible break,
  gated to the moment they _switch_ runtime — under express the runtime
  drivers ARE the express objects (structural), so existing code keeps
  compiling.

## 7. Risks

| Risk                                                                     | Mitigation                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Fastify perf expectations (pipeline bypasses schema serialization)       | Document; later: feed `RouteMeta` schemas into Fastify's serializer when present           |
| h3 v2 beta churn                                                         | Pin minor; adapter is ~300 LOC; v1 fallback documented                                     |
| next-fall-through hacks (Fastify notFound continuation)                  | Covered by runtime conformance tests (§9); only exercised in dev/Vite                      |
| DevTools migration size (26 handlers)                                    | Mechanical; ctx-handlers are shorter than the originals                                    |
| Multer semantics differences across backends                             | `UploadedFile` interface is the contract; conformance fixtures upload through all runtimes |
| Adapter-ecosystem breakage (third-party adapters using `app` as Express) | `app` escape hatch remains; deprecation cycle + loud changelog                             |

## 8. Future: web-standard driver (Avenue C convergence)

`RuntimeRequest`/`RuntimeResponse` were shaped so a `webRuntime()` can
implement them over WHATWG `Request`/`Response` + `ReadableStream`
(h3 v2 native; srvx for Node). When that lands, edge targets (Bun, Deno,
workers) cost one runtime package, not a core rewrite. SSE becomes a
`ReadableStream` under that driver; `write/end` remain the portable
primitive until then.

## 9. Milestones

| Milestone                          | Scope                                                                                                                                                                                                  | Risk                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| **M1 — seam extraction**           | `HttpRuntime` + `RouteTable` + runtime drivers in core; `expressRuntime()` implements them; zero behavior change (golden tests: full kickjs suite must pass untouched)                                 | Medium (core refactor)      |
| **M2 — adapter facade**            | `AdapterContext.http`; migrate swagger/queue/mcp; devtools last                                                                                                                                        | Low (mechanical)            |
| **M3 — `@forinda/kickjs-fastify`** | Runtime adapter + middie bridge + uploads + conformance suite (shared fixture app run under both runtimes via supertest: routes, contributors, errors, SSE, uploads, shutdown draining, Vite dev boot) | Medium                      |
| **M4 — `@forinda/kickjs-h3`**      | Runtime adapter on v2 beta (or v1 fallback), same conformance suite                                                                                                                                    | Medium-high (upstream beta) |
| **M5 — docs + scaffold**           | `kick new --runtime fastify\|h3\|express`, runtime guide, capability matrix in docs                                                                                                                    | Low                         |

The **conformance suite** (M3) is the centerpiece: one fixture app, one
spec file, parameterized over every registered runtime — the same trick
the db package uses for its dialect emitters.

## 10. Open questions

1. `trustProxy` semantics differ per engine — normalize in core (parse
   X-Forwarded-For ourselves) or pass through per-runtime config?
   Leaning: normalize in core; engines disable their own handling.
2. Should `bodyParser` live in core or per-runtime? Leaning: marker
   object in core, implementation per-runtime (§6).
3. Fastify logging: its built-in pino vs kickjs Logger — disable
   Fastify's (`logger: false`) and keep request-logger middleware, or
   bridge? Leaning: disable, keep ours (consistency across runtimes).
4. Versioned mounting (`/api/v1`) is plain path prefixing — confirmed
   portable; multi-mount `routes()` arrays too. Any adapter relying on
   express `Router` param inheritance (`mergeParams`) needs an audit
   during M2.
