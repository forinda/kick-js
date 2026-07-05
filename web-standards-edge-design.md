# Web Standards & Edge Runtime Design — KickJS on h3 v2

> Status: **SHIPPED** — P0 (#440), P1 `h3WebRuntime` (#441), P2 `@forinda/kickjs/web` (#442),
> P3 docs (`docs/guide/edge-deployment.md`). Remaining follow-ups live in §6 open questions
> (KV stores, adapters-on-edge, `ctx.waitUntil`).
> Decision owner: @forinda
> Engine decision: **h3 v2 as the web-standard engine** (chosen over a zero-dep hand-rolled runtime)
> Channel: TBD after spec review (precedent: fastify/h3 runtimes shipped via `alpha`)

## 1. Goal

KickJS apps run unchanged on **Bun**, **Deno**, and **edge runtimes (Cloudflare Workers first)** by exposing a **web-standard `fetch(Request) → Promise<Response>` handler**, alongside the existing node runtimes (Express default, Fastify, h3).

```ts
// workers entry — the whole deployment story
import { createWebApp } from '@forinda/kickjs/web'
import { modules } from './modules'

const app = await createWebApp({ modules })
export default { fetch: app.fetch }
```

```ts
// bun entry
Bun.serve({ fetch: app.fetch })
```

## 2. Facts this design rests on (researched 2026-07-05)

### h3 v2

- npm `latest` = `2.0.1-rc.22` (May 2026). No stable `2.0.0` tag yet; API frozen through a ~year-long RC series. v1 line lives under dist-tag `1x` (1.15.11). Repo: `h3js/h3`, docs: h3.dev.
- Fully web-standard: `new H3()` (router built in), handlers **return** values, `event.req` is a web `Request` (srvx `ServerRequest`), `event.url` is a `URL`, params via `event.context.params`, `app.fetch(request) → Promise<Response>`.
- **`event.node.req/res` is GONE** → `event.req.runtime?.node?.req/.res`, node-only, `undefined` on edge. Our current `h3.ts` (v1, `event.node.*` throughout) breaks on v2 regardless of edge plans.
- `readMultipartFormData()` removed → `await event.req.formData()` (web `FormData`/`File`).
- v1 utils that survive: `getQuery`, `getRouterParams`, `readBody` — incremental migration possible.
- srvx underneath: same `serve(app)` entry on Node/Deno/Bun (native servers; Node gets a `NodeRequest` proxy at ~97% native perf). Edge: don't call `serve()`, export `app.fetch`.

### ALS availability (we require `AsyncLocalStorage` per request)

| Runtime            | ALS | Notes                                                                                                   |
| ------------------ | --- | ------------------------------------------------------------------------------------------------------- |
| Cloudflare Workers | ✅  | `nodejs_compat` flag (or `nodejs_als`); `enterWith/disable` omitted — we only use `run()` ✅            |
| Deno / Deno Deploy | ✅  | node-compat, no caveats in current docs                                                                 |
| Bun                | ✅  | nested-`run()` perf issue being optimized (oven-sh/bun#24324) — we use one frame/request                |
| Vercel Edge        | ⚠️  | supported, but Vercel recommends migrating edge→Node (Fluid compute); target their Node runtime instead |
| Netlify Edge       | ❌  | ALS effectively unavailable — NOT a launch target; Netlify Node functions fine                          |

### KickJS blocker inventory (full audit in PR #438 session; key items)

- **Gating**: `http/index.ts` barrel eagerly re-exports `Application`/`bootstrap`/`expressRuntime` whose modules do top-level runtime imports of `node:http`, `node:cluster`, `express`. Edge needs a **separate subpath entry** that never touches them.
- `RuntimeResponse` (`http/runtime.ts:111-124`) is web-implementable: simple set (`status/json/send/type/setHeader/headersSent`) buffers into a `Response`; stream set (`writeHead/flushHeaders/write/end/once`) is only exercised by `ctx.sse()`/`download` → `TransformStream`.
- `RequestContext` req couplings: plain-object `req.headers` assumption; `req.once('close')` for `ctx.signal` (`context.ts:395-406`) and SSE (`:789`) → must bridge from the platform's `request.signal` instead.
- Shim-able: `node:crypto` `randomUUID` → `globalThis.crypto.randomUUID` (request-scope, request-id); `randomBytes` → `crypto.getRandomValues` (csrf, trace-context); `process.env.NODE_ENV` per-request reads → module-level const; `Buffer` under `nodejs_compat` (long-term: `Uint8Array`).
- Architecturally edge-incompatible (opt-in only): in-memory session/rate-limit stores (`setInterval` + process-local Maps). Out of scope for launch — document; KV-backed stores are follow-up work.
- Bun: runs node APIs natively — existing Express runtime likely already works on Bun. Workers is the strict conformance target.

## 3. Architecture

### 3.1 Two deliverables, one driver

> **Locked 2026-07-05 (@forinda): the existing h3 v1 runtime is NOT rewritten or removed.**
> Adopters on `bootstrap({ runtime: h3Runtime() })` + h3 v1 keep working unchanged.
> The v2 path ships as a NEW, parallel export — zero breakage, pure opt-in.

1. **New `h3WebRuntime()`** (working name `h3Web`, new file `runtimes/h3-web.ts`, own subpath) — the h3 **v2** engine for node-server usage via `bootstrap({ runtime: h3WebRuntime() })`. `h3.ts` (v1) stays as-is. Peer constraint: an app installs ONE h3 version — v1 with `h3Runtime()`, v2 with `h3WebRuntime()`; peer range widens to `^1.0.0 || ^2.0.0-rc || ^2.0.0` and each runtime fails fast with a clear error when the wrong major is installed.
2. **New `@forinda/kickjs/web` subpath** — `createWebApp({ modules, ... })` builds the route table + DI + contributor pipeline exactly like `Application.setup()` but WITHOUT importing `application.ts`/`bootstrap.ts`/express, mounts routes on a `new H3()` (v2), returns `{ fetch, h3 }`.

Both share the new **web driver pair**:

- **`WebRequestShim`** — presents a web `Request` as the express-shaped `req` that `RequestContext` reads:
  - `headers`: plain lower-cased object materialized once from `request.headers`
  - `method`, `url`, `body` (assigned after parse), `params` (from `event.context.params`), `query` (from `event.url.searchParams`)
  - `once('close', fn)` / `on('close', fn)`: delegated to `request.signal.addEventListener('abort', fn, { once: true })` — keeps `ctx.signal` + SSE close semantics without EventEmitter
  - `requestId`, `session`, `user`, `file`, `files`: ad-hoc props as today
- **`WebResponseDriver implements RuntimeResponse`** — class (shared prototype, per the lifecycle-perf precedent):
  - Buffered mode (default): records status/headers/body; `toResponse()` produces the final `Response`
  - Stream mode (first `writeHead`/`write`/`flushHeaders` call): switches to a `TransformStream`, returns `new Response(readable, { status, headers })` immediately; `write` → writer, `end` → `writer.close()`, `once('close')` → request signal abort. SSE works on edge this way.
  - `render()` throws (no view engine on web runtime — same as current h3 v1 driver)

### 3.2 Request flow (web entry)

```
Request → app.fetch → h3 route match → kick handler wrapper:
  WebRequestShim(event) → createRequestStore(headerId ?? crypto.randomUUID())
  → requestStore.run(store):
      validator? (built once per route)
      → middlewares (ctx,next)
      → contributorRunner (topo order, boot-built — unchanged)
      → controller handler
  → driver.toResponse()  (or streamed Response already returned)
  finally: request.signal/waitUntil → disposeRequestStore(store)   // @PreDestroy
```

`@PreDestroy` note: on Workers, post-response work should go through `event.waitUntil()`; disposal hooks fire there rather than on a `close` event.

### 3.3 Uploads

h3 v2 path: `await event.req.formData()` → adapt `File` entries into the existing `RawUploadPart[]` (`fieldname`, `filename`, `mimetype`, `buffer: await file.arrayBuffer()`) → existing `applyUploadConfig()` unchanged. No multer, no temp files. `Buffer.from(arrayBuffer)` under nodejs_compat now; `Uint8Array` refactor is follow-up.

### 3.4 What the `/web` entry must NOT import

`application.ts`, `bootstrap.ts`, `cluster.ts`, `runtimes/express.ts`, any `node:` runtime import outside ALS. Enforced by a bundle-graph test (build the web entry, assert externals/imports contain no `node:http`/`node:cluster`/`express`). `node:async_hooks` stays — it's the one sanctioned node API (universal per the ALS matrix).

### 3.5 Env/config on edge

Workers pass env as `fetch(req, env, ctx)` — no ambient `process.env`. `createWebApp({ env?: Record<string,string> })` option seeds the ConfigService resolver; the Workers entry closes over `env` on first request (or via `app.fetch = (req, env, ctx) => …` wrapper that initializes once). Exact wiring is an open question (§6 Q3).

## 4. Phases

| Phase  | Content                                                                                                                                                                                                                                                       | Breaking?                                       | Size                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------- |
| **P0** | `globalThis.crypto.randomUUID` in request-scope/request-id; `crypto.getRandomValues` in csrf/trace-context. (NODE_ENV module-const DROPPED — tests stub it per-case via `vi.stubEnv`; nodejs_compat polyfills `process.env` on all launch targets anyway)     | No                                              | XS — landed 2026-07-05 |
| **P1** | NEW `h3WebRuntime()` in `runtimes/h3-web.ts` on h3 v2: H3 class, event.req, WebRequestShim + WebResponseDriver, formData uploads. `h3.ts` (v1) untouched. Peer widened `^1.0.0 \|\| ^2.0.0-rc \|\| ^2.0.0`, each runtime fail-fast checks the installed major | **No** — additive; v1 adopters keep the old way | M                      |
| **P2** | `@forinda/kickjs/web` subpath: `createWebApp()`, fetch export, bundle-graph purity test, Workers/Bun/Deno smoke tests (`app.fetch(new Request(...))` unit-level + wrangler/bun CI jobs later)                                                                 | No (additive)                                   | M                      |
| **P3** | Examples + docs: wrangler.toml (`nodejs_compat`), `Bun.serve`, Deno; edge caveats page (no in-memory stores, ALS matrix); CLI `--target edge` template                                                                                                        | No                                              | S–M                    |

P1 and P2 land together on `alpha` or sequentially — P2 depends on P1's driver pair.

## 5. Testing strategy

- Unit: `app.fetch(new Request('http://x/route'))` round-trips — no server needed, runs in vitest on node. Covers routing, ctx surface, validation, problem responses, SSE streaming (read the `Response.body` stream), uploads via constructed `FormData`.
- Purity: bundle-graph test per §3.4.
- Conformance (CI, later): `bun test` job running the same fetch suite under Bun; `wrangler dev --local`/workerd smoke job for Workers.

## 6. Open questions

1. **h3 v2 RC as peer** — accept `^2.0.0-rc.22` now (npm `latest`, API frozen) or wait for GA? Proposal: accept RC on the alpha channel; revisit at GA.
2. **`ctx.render()`/views, SPA, static** on web runtime — throw (like h3 v1 driver today) or asset-manifest-based serving later? Proposal: throw at launch.
3. **Env injection shape** for Workers (`fetch(req, env, ctx)`): first-request lazy init vs explicit `app.bind(env)`; interaction with `loadEnv()`/Zod schema validation on edge. Needs a small design of its own.
4. **`event.waitUntil` exposure** — surface on `ctx` (e.g. `ctx.waitUntil(promise)`) for background work on edge? Cheap to add in P2.
5. **Devtools/otel** on edge — out of scope at launch; verify they degrade gracefully when imported (they're adapters, not core).
6. **Session/rate-limit KV stores** (Workers KV / Durable Objects / Redis-over-HTTP) — follow-up package(s) or recipes-only? Proposal: recipes-only at launch.

## 7. Non-goals (launch)

- Netlify Edge (no ALS), Vercel Edge (deprecated in favor of their Node runtime)
- View engines / SPA / static file serving on the web runtime
- KV-backed session/rate-limit store implementations
- Replacing srvx/h3's node server path — `bootstrap()` on node keeps the existing runtimes
