# Typed Response Inference — Return-Value Handlers, KickRoutes.response, Typed Client

> Status: **DRAFT — spec only, no implementation yet** (2026-07-06)
> Decision owner: @forinda
> Prior art in-repo: `docs/guide/tutorial-typed-client.md` (the vision), `kick typegen`'s
> `kick/routes` plugin (the vehicle), the edge/web-standards rollout (the process template).

## 1. Goal

Close the type loop from controller to consumer: the response type of every route is
**known statically** — surfaced in the `KickRoutes` augmentation next to the existing
`params`/`body`/`query`, and consumable by a generated tRPC-style client:

```ts
const api = createClient<KickApi>({ baseUrl: 'https://api.example.com' })

const task = await api.post('/api/v1/projects/:projectId/tasks', {
  params: { projectId: 'p1' },
  body: { title: 'Fix bug', priority: 'high' }, // typed from the Zod schema
})
// task: { id: string; title: string; ... }  ← inferred from the handler
```

## 2. Facts this design rests on

### Why inference is blocked today

Handlers respond **imperatively** — `ctx.json(data)` / `ctx.created(x)` — so every
handler's declared type is `Promise<void>`. The response type exists only as an argument
at a call site, invisible to `ReturnType<>`. Confirmed in all four runtimes: the terminal
handler is invoked as `await entry.handler(ctx)` and any return value is dropped
(`runtimes/express.ts:83`, fastify/h3 equivalents, `web/handler.ts` — which today answers
"pipeline finished without responding" with a canonical 404).

### Why decorators can't do it at the type level

TS decorators cannot change or export the type of the thing they decorate, and the route
path/verb are runtime strings in metadata — their literal types never attach to the class
type. So a purely type-level `InferApi<Controller>` can recover **response types only**
(method return types), not paths, verbs, or body/query. Chained-builder frameworks (Hono,
Elysia) infer fully because routes are _value expressions_ with accumulating generics —
not KickJS's identity.

### What already exists

- **`kick typegen` → `kick/routes` plugin** (`packages/cli/src/typegen/builtin/routes.ts`):
  scans `src/**/*.controller.ts` + modules via a shared AST scan, renders a `KickRoutes`
  augmentation with per-route `params`/`body`/`query` (Zod-aware via
  `typegen.schemaValidator`), emits `.ts` with hoisted `import type` so schema types
  resolve. Re-runs on watch in `kick dev`.
- **The web pipeline precedent**: `web/handler.ts` already has the exact branch point
  ("pipeline done + driver unsettled") where auto-send slots in.
- h3 v2 / Hono / Elysia all standardized on **return-the-value** handlers — adopters
  arriving from those expect it.

## 3. Architecture

Three layers, each independently useful:

### 3.1 Layer A — return-value handlers (runtime)

Handlers may **return** the response payload; the runtime auto-sends it when the pipeline
completes with the driver unsettled:

```ts
@Get('/:id')
async get(ctx: RequestContext) {
  return this.users.find(ctx.params.id) // → 200 application/json
}
```

Rules (all four runtimes — express materializer, fastify, h3 v1, web/h3-web):

| Handler outcome                        | Behavior                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `ctx.json/...` called (driver settled) | unchanged — return value ignored                                                   |
| returns `undefined` / `void`           | unchanged — falls through to today's behavior (404 on web, notFound chain on node) |
| returns object/array/primitive         | `ctx.json(value)` — 200                                                            |
| returns a `Reply` wrapper (below)      | status + body from the wrapper                                                     |
| throws                                 | unchanged — error pipeline                                                         |

Status codes without `ctx`: a tiny value wrapper, transparent to inference:

```ts
return reply(201, task) // Reply<201, Task> — typed status + body
return reply.created(task) // sugar for the common codes
```

`Reply<S, T>` is a plain `{ status: S; body: T }` brand the runtimes unwrap and the
type layer (3.2) understands (`InferResponse<Reply<201, Task>> = Task`).

**Fully additive.** Imperative `ctx` style remains first-class; return style is opt-in
per handler. `ctx.paginate(...)` already returns its payload — under return-style it
just works (handler returns what paginate produced; driver settled either way).

### 3.2 Layer B — `response` in KickRoutes (typegen)

The `kick/routes` scan gains response extraction per route, in priority order:

1. **Return type** of the handler method (via the TS checker the scanner already runs) —
   `Awaited<ReturnType>`, unwrapping `Reply<S, T>` → `T`, dropping `void`/`undefined`
   members. This is why Layer A matters: return-style handlers make this exact.
2. **`ctx.json(arg)` / `ctx.created(arg)` argument types** (AST call-site scan) for
   imperative handlers — best-effort union when multiple call sites.
3. **Declared override** — `@ApiResponse({ schema })` / a `response` slot in the route
   decorator's validation object, when adopters want the schema (not the impl) to be
   the contract. Wins over 1–2 when present.

Emission: `KickRoutes[path][method].response` alongside the existing fields. Nothing
about the emission pipeline changes — same plugin, same watch loop, one more rendered
field.

### 3.3 Layer C — typed client (`@forinda/kickjs-client` or `kick generate:client`)

A ~100-line fetch wrapper typed by the augmentation:

```ts
import { createClient } from '@forinda/kickjs-client'
import type { KickApi } from './.kickjs/types/kick__routes'

const api = createClient<KickApi>({ baseUrl, headers: () => ({ Authorization: ... }) })
const task = await api.post('/api/v1/tasks/:id', { params: { id }, body })
```

- Path-keyed (template-literal param substitution), NOT proxy-RPC — matches REST identity
  and the existing `KickRoutes` shape.
- Fetch-based → runs in browsers, node ≥ 20, and on the edge (pairs with
  `@forinda/kickjs/web` — same web standards on both ends).
- Error channel: non-2xx → typed `KickClientError` carrying the RFC 9457 problem body
  (`ctx.problem` is already the canonical error shape).
- Delivery: prefer a small published package consuming the generated types over
  `generate:client` codegen — less generated surface, same DX. Decide at C.

## 4. Phases

| Phase  | Content                                                                                                                                                                                         | Breaking?                       | Size |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---- |
| **R1** | Return-value handlers in all 4 runtimes + `reply()` wrapper + docs. Web handler: replace the "finished without responding → 404" branch with auto-json-if-returned (404 stays for `undefined`). | No — additive                   | S–M  |
| **R2** | `kick/routes` response extraction (return-type first, `ctx.json` call-site fallback, declared override) + `response` field in the render + `KickRoutes` type tests                              | No — augmentation gains a field | M    |
| **R3** | Typed client package + docs (`tutorial-typed-client.md` graduates from vision to guide)                                                                                                         | No — new package                | M    |

R1 lands alone and is useful without any types (less boilerplate). R2 depends on R1 only
for _precision_ (call-site fallback covers imperative handlers regardless). R3 depends on R2.

## 5. Testing

- R1: per-runtime fetch/supertest round-trips — returned object → 200 json; `reply(201, x)`
  → 201; `undefined` → unchanged 404/notFound; `ctx.json` + return → ctx wins. Lifecycle
  suite re-run (auto-send must not fight `@PreDestroy`/SSE paths).
- R2: typegen snapshot tests (existing harness) — return-style, imperative multi-callsite
  union, `Reply` unwrap, declared override precedence.
- R3: type-level tests (`expectTypeOf`) against a fixture `KickRoutes` + one runtime
  round-trip against a `createWebApp` fetch handler (no server needed).

## 6. Open questions

1. **`reply()` naming/shape** — `reply(status, body)` vs `ctx`-free `respond()` vs
   reusing `HttpStatus` enums. Also: headers in the wrapper or ctx-only?
2. **Union responses** — handler with branches returning different shapes: emit the union
   (honest) or require a declared override (strict)? Proposal: emit the union.
3. **Streaming/SSE routes** — `response: never` or a branded `SseStream` type in the map?
4. **`successResponse(...)` envelope pattern** (from the vision doc) — generic passthrough
   is automatic via return types; no special handling needed. Confirm with a fixture.
5. **Client package name** — `@forinda/kickjs-client` (new package) vs a `client` subpath
   of `@forinda/kickjs` (but the client must not drag the server graph — subpath purity
   would need the same bundle test as `/web`).
6. **OpenAPI reuse** — should R2's extracted response types also feed the Swagger
   adapter's response schemas? (Today `@ApiResponse` is manual.) Likely yes, later.

## 7. Non-goals

- Full tRPC-style procedure RPC (`api.tasks.create(...)`) — path-keyed client first;
  a proxy sugar layer can sit on top later without new inference.
- Runtime response validation (schemas validating what handlers return) — separate
  feature, separate cost/benefit.
- Inferring body/query purely at the type level — stays typegen's job (decorator type
  erasure makes it impossible without changing how routes are declared).
