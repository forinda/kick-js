# @forinda/kickjs

## 6.5.0

### Minor Changes

- [#478](https://github.com/forinda/kick-js/pull/478) [`139c5dd`](https://github.com/forinda/kick-js/commit/139c5dd94346ca2e65d32ad5b2e366cbeae7e6c6) Thanks [@forinda](https://github.com/forinda)! - Close the gap between what context decorators guarantee and what the type system knows, and fix two checks that reported the wrong thing.

  **`ctx.require(key)`** — reads a value a contributor is expected to have produced and throws `MissingContextValueError` (naming the key and route) when it hasn't. `ctx.get(key)` returns `T | undefined` for every key, so consuming a guaranteed value meant `ctx.get(key)!` — an assertion that compiles whether or not the producing decorator is applied to the route. On an authorization value that fails open and silently. `require()` returns `Exclude<MetaValue<K>, undefined>`, so the `!` goes away too. `null` still counts as present — only `undefined` throws, which is why the return type excludes `undefined` rather than using `NonNullable`.

  Compile-time narrowing (making a dropped decorator a `tsc` error) needs per-route context-key unions from typegen and is deferred — the design is recorded in `architecture.md` §20.14.

  **Required params are enforced at the call site.** A required field of `P` with no `paramDefaults` entry must now be supplied wherever the decorator is applied; the bare `@Foo` form, `@Foo()`, and `.registration` are compile errors for such a decorator. Previously `paramDefaults` was the only way to satisfy a required field, which pushed adopters into inventing placeholder defaults (`action: 'settings:read'` on a permission contributor every call site overrides) — and a route that then forgot the argument silently gated on the placeholder. The new optional `requiredParams: ['action']` enforces the same rule at runtime for plain-JS and `as any` call sites.

  **`kick typegen --check` actually fails now.** The wrapper that keeps a transiently-broken plugin from crashing `kick dev` was also catching the deliberate drift error, downgrading it to a `console.warn("… skipped")` and returning an empty result set — so the command exited 0 on drift, for every plugin, since the flag was introduced. Drift now propagates as `TypegenDriftError` listing every stale file in one pass, and a plugin that fails to generate under `--check` fails the gate instead of passing on "keeping previous output".

  **`kick doctor` no longer false-alarms on extended tsconfigs.** The loader followed exactly one level of `extends`, only when it was a string, resolved relative paths against the project root rather than the extending file, looked for bare specifiers only in the project's own `node_modules`, and parsed parent configs as strict JSON. Any one of those made a project that sets `experimentalDecorators` / `emitDecoratorMetadata` in a shared base config get told it was missing them — and lean per-package configs in a monorepo hit all of them. Now: chains of any depth, array `extends` (TS 5.0+), `node_modules` lookup walking up the tree (pnpm hoisting), directory specifiers resolving to `tsconfig.json`, and JSONC parsing (comments and trailing commas) throughout. A tsconfig that exists but can't be parsed now reports as unreadable rather than as missing.

  **Agent docs and the contributor scaffold teach the full surface.** `kick g agents` output covered context contributors thinly enough that agents routinely missed the call-site rules: the `.registration` / `.with({...}).registration` forms that module, adapter, and bootstrap sites actually take (passing the decorator itself is the most common wiring bug), when to reach for `.withParams<P>()`, and how to read a value back. Both the `AGENTS.md` section and the `kickjs-context-contributor` skill now carry the five registration sites, the params rules, the read-back table, and `ctx.get(key)!` / `contributors: [Decorator]` as named red flags.

  `kick g contributor --params` no longer scaffolds placeholder `paramDefaults` (`action: ''`). It emits `requiredParams` instead, so the generated contributor demands its params at every call site — the scaffold was previously teaching the exact pattern that made forgotten arguments silent.

  `ExecutionContext` gains a `require` member. Hand-written implementations of that interface need to add it; `RequestContext` and the `@forinda/kickjs-testing` fake contexts already do.

- [#480](https://github.com/forinda/kick-js/pull/480) [`1ebcd00`](https://github.com/forinda/kick-js/commit/1ebcd000d84d8514b06cf1633ceccbbff4678c85) Thanks [@forinda](https://github.com/forinda)! - Make an unexpected 500 diagnosable. Previously it told you nothing on either side at once — an adopter hitting a missing-table error had to go to the database to find out what happened.

  **`Logger.error(err, msg)` discarded the error object.** The error-first form is the framework's own idiom at ~16 call sites (`error-handler`, `application`, `bootstrap`, `request-scope`, plus the `ai` and `mcp` adapters), and every one of them was logging a bare sentence: the implementation called `provider.error(msg)` with the error appearing nowhere in the call, so **no stack, no error name, no `cause` chain** ever reached the log. The error is now forwarded to the provider as a trailing argument — `console` renders the full stack, and pino/winston adapters receive it as structured extra. The message-first form (`log.error('save failed', { id })`) was dropping its trailing args for the same reason; also fixed.

  **Unexpected 500 responses carry a correlation id and, outside production, real detail.** The body was a bare `{ message: 'Internal Server Error' }` in every environment. It now always includes `requestId` (from the request-scoped id, falling back to the inbound `x-request-id` header, omitted when neither exists) — without it an opaque 500 can't be tied to its own log line. Outside production the body also carries `error` (an error summary that walks the `cause` chain, which is where ORM and driver errors hide the reason that matters) and `stack`. Production bodies stay opaque: no message, no stack.

  **The web/edge error fallbacks were completely silent.** `web/handler.ts` and the h3 v2 runtime emitted `{ error: 'Internal Server Error' }` with no log call at all, so a failure reaching those last-resort branches left no trace anywhere. Both now log the error and include the summary outside production.

  **New `describeError(err)` export** — one-line error summary including the error name and `cause` chain, depth-capped and cycle-guarded. Used by the error paths above; exported because adopters writing a custom `onError` want the same thing.

  **Edge-safety fix:** `logger.ts` read `process.env.LOG_LEVEL` unguarded, so importing it from a strict edge runtime with no `process` global threw. The colour probe next to it was already guarded; this one wasn't. It matters now that the edge-safe web pipeline imports the logger.

  The cross-runtime conformance test for thrown errors now asserts the shared invariant (500 + opaque message + a `requestId`) rather than deep-equalling the old bare body, and passes on express, fastify, and h3 alike.

- [#481](https://github.com/forinda/kick-js/pull/481) [`5667c4b`](https://github.com/forinda/kick-js/commit/5667c4b1f5e95c16a414c9262a9b420bdfb0b27b) Thanks [@forinda](https://github.com/forinda)! - Per-route context-key narrowing — a dropped contributor decorator is now a compile error.

  `kick typegen` emits a `contextKeys` union per route from the context decorators applied at method and class level, and `ctx.require()` is narrowed to it. Removing a decorator removes the key:

  ```text
  error TS2345: Argument of type '"operatorPerm"' is not assignable to parameter of type '"tenant"'.
  ```

  That refactor was previously invisible to `tsc` — `ctx.get('operatorPerm')!` compiled whether or not the decorator was applied, and the handler read `undefined` into an authorization check.

  **`ctx.get()` is deliberately not narrowed.** The original design (`architecture.md` §20.14) proposed dropping `| undefined` from `get()` for keys typegen believes are present. That was not built, because the two options fail in opposite directions: narrowing `get()` wrongly produces a value the types promise and the runtime doesn't deliver — silent, fails open, the exact failure this line of work removed. Narrowing `require()` wrongly produces a compile error — loud, fails closed, and covered by an escape hatch.

  **Narrowing applies only where completeness is provable.** A route gets a key union only when every decorator on it is either a known contributor-free framework decorator or a resolvable context decorator. Typegen emits `string` (no narrowing, today's behaviour) for an unrecognised decorator — adopter decorators can bundle contributors of their own — an unresolvable import, an ambiguous binding name, a route recovered by the regex fallback, or the presence of **any** contributor registered at module / adapter / bootstrap level, since a global registration adds keys to routes that carry no decorator for them. `never` is distinct from `string`: it means the scanner proved the route carries no contributors, so `require()` on it really is a mistake.

  **Escape hatch:** type the handler as plain `RequestContext` rather than `Ctx<KickRoutes…>` — `TKeys` defaults to `string` and no narrowing applies.

  API changes, both source-compatible: `RequestContext` gains a fourth type parameter `TKeys extends string = string`, and `ExecutionContext` becomes `ExecutionContext<TKeys extends string = string>`. Existing annotations keep working — the defaults reproduce today's behaviour exactly. `RouteShape` gains an optional `contextKeys` member.

  Module, adapter, and bootstrap registration sites are detected but not yet resolved; resolving them (so a module-scoped contributor narrows instead of degrading the project) is the next increment.

## 6.4.0

### Minor Changes

- [#471](https://github.com/forinda/kick-js/pull/471) [`dc60f42`](https://github.com/forinda/kick-js/commit/dc60f420299c961a83d9b7df6ea32b12de80afc8) Thanks [@forinda](https://github.com/forinda)! - Boot-time duplicate-route guard (KICK006). Two handlers claiming the same HTTP verb + mounted path now fail `Application.setup()` / `createWebApp()` with a structured `KickError` instead of silently losing the dispatch race — previously the engine served one handler while `kick typegen` and the typed client could describe the other. Param names are ignored when comparing (`GET /tasks/:id` and `GET /tasks/:taskId` collide). Same path under a different verb or module `version` is unaffected.

  Heads-up: an app that today registers the same route twice (a latent bug — only one handler ever ran) will now fail at boot with a KICK006 pointing at both registrations.

- [#472](https://github.com/forinda/kick-js/pull/472) [`7f3e2aa`](https://github.com/forinda/kick-js/commit/7f3e2aa8579813bc5e427a1bd18c27e8075c4030) Thanks [@forinda](https://github.com/forinda)! - Edge-ready rate limiting and sessions:

  - `rateLimitGuard()` — ctx-style rate limiter that runs on every runtime AND the `@forinda/kickjs/web` fetch entry (the connect-style `rateLimit()` stays node-only). Sends `X-RateLimit-*` / `Retry-After` headers, pluggable key generator (`cf-connecting-ip` → `x-forwarded-for` → `x-real-ip` by default).
  - `KvRateLimitStore` / `KvSessionStore` over a minimal `KvLike` interface — structurally a Cloudflare Workers `KVNamespace` binding, so `new KvRateLimitStore(env.MY_KV, { windowMs })` just works. `KvSessionStore` plugs into the existing node `session()` middleware.
  - `createWebApp({ middleware })` — global `(ctx, next)` middlewares on the web entry, the counterpart of `bootstrap({ middleware })`.
  - `ctx.setHeader(name, value)` — runtime-neutral response header setter on `RequestContext`.

  All new modules are zero-runtime-import and part of the edge purity graph.

## 6.3.1

### Patch Changes

- [#467](https://github.com/forinda/kick-js/pull/467) [`a2bfaa8`](https://github.com/forinda/kick-js/commit/a2bfaa87657654bacfe3ab92a55bf9978d3d4a40) Thanks [@forinda](https://github.com/forinda)! - fix: installing alongside `h3@latest` (the v2 RC line) no longer fails with ERESOLVE

  The `h3` peer range could not admit h3's RC releases: semver only lets a
  prerelease satisfy a range whose comparator shares its exact
  `major.minor.patch` tuple, and the RC line moves tuples (`2.0.1-rc.23`).
  No static range can express "any 2.x prerelease", so the optional `h3`
  peer declaration is removed entirely — the h3 runtimes already fail fast
  at load with clear guidance when the wrong major is installed (v1 for
  `h3Runtime()`, v2 for `h3WebRuntime()` / `@forinda/kickjs/web`). The peer
  constraint will return as `^1 || ^2` once h3 v2 ships stable.

## 6.3.0

### Minor Changes

- [#465](https://github.com/forinda/kick-js/pull/465) [`0313b95`](https://github.com/forinda/kick-js/commit/0313b9576de7fd15ebc6467cfdbb210f19b3fee1) Thanks [@forinda](https://github.com/forinda)! - feat: typed SSE end to end + the `KickApi` alias

  ```ts
  // server — ctx.sse is now generic; `return sse` carries the event type
  const sse = ctx.sse<{ n: number }>();
  sse.send({ n: 1 }); // typed
  return sse;

  // client — only SSE routes accepted; events typed
  const stream = await api.stream("/events");
  for await (const ev of stream) ev.data; // { n: number }
  ```

  - `@forinda/kickjs`: `SseHandler<T>` (phantom `__sse` marker — structural
    detection, no server imports needed client-side)
  - `@forinda/kickjs-client`: `api.stream()` — fetch-based SSE parser (works
    with injected fetch/`createTestClient`), `SseEvent<T>` with JSON-parsed
    data + `event`/`id`, `close()` aborts; also STRICTER options: omitting a
    required `params`/`body` argument is now a compile error (was a runtime
    throw)
  - `kick typegen` emits a global `KickApi` alias for `KickRoutes.Api` —
    `createClient<KickApi>` everywhere

### Patch Changes

- [#460](https://github.com/forinda/kick-js/pull/460) [`f4e0b10`](https://github.com/forinda/kick-js/commit/f4e0b105d91303a53ada7b7cc4a83cd386a0b1a4) Thanks [@forinda](https://github.com/forinda)! - docs: README refresh — web-standard entries (`/h3-web`, `/web` for Workers/Bun/Deno), return-value handlers, and the typed-client loop

- [#457](https://github.com/forinda/kick-js/pull/457) [`d08c1b9`](https://github.com/forinda/kick-js/commit/d08c1b917dadc8d4287104c5c2d8f43e5844a5ed) Thanks [@forinda](https://github.com/forinda)! - feat: declared response schemas — one declaration feeds Swagger AND the typed client

  ```ts
  @Get('/', { response: taskSchema })
  list() { return this.tasks.all() }
  ```

  - `RouteDefinition.validation.response` (`@forinda/kickjs`): a declared,
    never-runtime-validated response contract
  - `@forinda/kickjs-swagger`: the schema documents the auto-generated success
    response (`200`/`201`) as `application/json` content in
    `components/schemas`; explicit `@ApiResponse` entries still win; `204`
    defaults stay body-less
  - `kick typegen`: a declared `response` schema overrides return-type inference
    for that route in `KickRoutes[...].response` (both scan paths)

  Docs, server types, and the typed client now share one source of truth per route.

## 6.2.0

### Minor Changes

- [#441](https://github.com/forinda/kick-js/pull/441) [`860b2d1`](https://github.com/forinda/kick-js/commit/860b2d1fe49fd6c0f94d6f69b6e096878bfb0366) Thanks [@forinda](https://github.com/forinda)! - feat: new `h3WebRuntime()` — h3 v2 web-standards runtime (additive)

  `@forinda/kickjs/h3-web` runs KickJS on the h3 v2 engine (WHATWG
  Request/Response, `app.fetch`). The existing h3 v1 runtime
  (`@forinda/kickjs/h3`) is untouched — adopters keep the old way; v2 is pure
  opt-in via `bootstrap({ runtime: h3WebRuntime() })`.

  - Shared web driver pair (`WebRequestShim`, `WebResponseDriver`): buffered
    responses build a web `Response`; SSE streams over a `TransformStream`
  - Uploads via web `FormData` (no multer)
  - `h3` peer widened to `^1.0.0 || ^2.0.0-rc || ^2.0.0`; the runtime fails
    fast with guidance when the wrong major is installed
  - `h3WebRuntime({ h3 })` accepts a pre-imported module for bundlers without
    `createRequire` (edge preparation)

  Groundwork for the `@forinda/kickjs/web` fetch entry (Bun / Deno /
  Cloudflare Workers) — see `web-standards-edge-design.md`.

- [#438](https://github.com/forinda/kick-js/pull/438) [`ff3e492`](https://github.com/forinda/kick-js/commit/ff3e492bb3261102be774d44730d878399417a46) Thanks [@forinda](https://github.com/forinda)! - perf + lifecycle: object-lifecycle audit fixes across the framework layer

  **Hot-path allocations removed**

  - Fastify/h3 runtimes: validation middleware is now built once per route
    (previously re-constructed on every request) and the response driver is a
    shared-prototype class (previously ~12 method closures allocated per request)
  - DI container: instantiation plans are precomputed per registration — REQUEST-
    and TRANSIENT-scoped resolves no longer re-read Reflect metadata (5 reads +
    2 throwaway Maps per instantiation)
  - `tokenName()` is no longer computed on the cached-singleton resolve path when
    no container change listener is attached
  - `ctx.problem` is memoized per context (was ~10 closures per access)
  - `@Autowired` singleton dependencies memoize into a data property on first
    read; REQUEST/TRANSIENT deps keep the live getter

  **Leaks fixed**

  - Reactivity: `watch().stop()` now detaches the effect from all dependency
    Sets (previously dead watchers accumulated and kept firing); effects re-track
    per run so conditional getters drop stale branches; `computed()` gains
    `dispose()`; `reactive()` memoizes nested proxies (stable identity)
  - `MemoryCacheProvider` is bounded (LRU, default 10 000 entries)
  - In-memory session/rate-limit store cleanup intervals are now disposed by
    `Application.shutdown()` via a new disposables registry
    (`registerDisposable`/`disposeAll`)
  - Container change-batch debounce timer is `unref()`'d and flushed on shutdown

  **New: `@PreDestroy`**

  Counterpart to `@PostConstruct`. On REQUEST-scoped services the hook runs when
  the response closes (finished or aborted) on all three runtimes — release
  per-request transactions/handles/subscriptions there.

  `@Cacheable` now caches legitimate `null` results (previously indistinguishable
  from a cache miss, so null-returning methods re-executed on every call).

- [#444](https://github.com/forinda/kick-js/pull/444) [`7812f43`](https://github.com/forinda/kick-js/commit/7812f437cc3d0fcff09dbba90850360b298e6b1a) Thanks [@forinda](https://github.com/forinda)! - feat: return-value handlers — `return` the payload instead of calling `ctx.json`

  Handlers on every runtime (Express, Fastify, h3, h3-web, `@forinda/kickjs/web`)
  may now return their response:

  ```ts
  @Get('/:id')
  async get(ctx: RequestContext) {
    return this.users.find(ctx.params.id)          // → 200 json
  }

  @Post('/')
  async create(ctx: RequestContext) {
    return reply(201, await this.users.create(ctx.body)) // → 201
  }
  ```

  - `reply(status, body)` + sugars (`created`/`accepted`/`noContent`) carry the
    status in the type (`Reply<201, Task>`) for upcoming response inference
  - Fully additive: `ctx.json` style unchanged and always wins over a return
    value; `undefined` returns keep prior behavior exactly
  - Foundation for typed response inference in `kick typegen` and the typed
    client (`response-inference-design.md`)

- [#445](https://github.com/forinda/kick-js/pull/445) [`bc6db15`](https://github.com/forinda/kick-js/commit/bc6db15edbaf938844ebd9d2595e559c020eea43) Thanks [@forinda](https://github.com/forinda)! - feat: response type inference — `KickRoutes[...].response` is now real

  `kick typegen` emits each route's `response` as a type reference to the
  controller handler itself:

  ```ts
  response: import("@forinda/kickjs").InferHandlerResponse<_C0["get"]>;
  ```

  Your tsc computes the actual type — the scanner stays checker-free and
  watch-fast. Return-value handlers yield their exact payload
  (`Reply<201, Task>` unwraps to `Task`); imperative `ctx.json` handlers
  degrade to `unknown` exactly as before.

  - `@forinda/kickjs`: new `InferHandlerResponse<H>` type (exported from the
    root, `/web`, and the http barrel)
  - `@forinda/kickjs-cli`: hoisted controller `import type` per (file, class),
    default-export controllers use a `default as` binding;
    `DiscoveredRoute.controllerIsDefaultExport` on both scan paths (AST + regex)

- [#442](https://github.com/forinda/kick-js/pull/442) [`da37fcf`](https://github.com/forinda/kick-js/commit/da37fcf96cd71be68f6aa34f8e08be1f5663201a) Thanks [@forinda](https://github.com/forinda)! - feat: `@forinda/kickjs/web` — web-standard fetch entry for edge runtimes, Bun and Deno

  `createWebApp({ h3, modules })` builds a KickJS app as a pure
  `fetch(Request) → Promise<Response>` handler — no node http server, no
  Application/bootstrap in the bundle graph. Same modules, DI, decorators and
  contributor pipeline as `bootstrap()`.

  ```ts
  // Cloudflare Workers (compatibility_flags = ["nodejs_compat"])
  import { createWebApp } from "@forinda/kickjs/web";
  import * as h3 from "h3"; // v2
  const app = createWebApp({ h3, modules });
  export default { fetch: (req) => app.fetch(req) };
  ```

  - `createFetchHandler((env) => options)` — Workers convenience that seeds
    ConfigService/@Value from the `env` binding on first request
  - Bundle purity enforced by test: the built `dist/web.mjs` graph contains no
    `express` and no `node:*` imports besides `node:async_hooks` (ALS)
  - Internal: container's `@Asset` resolution now goes through a resolver slot
    so the asset manager's `node:fs` never enters the edge graph; the pure
    upload core moved to `upload-config.ts` (public API unchanged)

### Patch Changes

- [#448](https://github.com/forinda/kick-js/pull/448) [`d64041d`](https://github.com/forinda/kick-js/commit/d64041dfe997a2060f5a2515ae5fa1dcac472626) Thanks [@forinda](https://github.com/forinda)! - fix: `KickRoutes.Api` keys are now module-mount-joined paths

  The flat client map keyed on the bare decorator path (`'GET /:id'`) instead of
  the mounted path (`'GET /tasks/:id'`) — every mounted controller's typed calls
  404'd, and multi-resource apps collided on `/:id`-style keys with routes
  silently dropped. Fixed by threading `DiscoveredRoute.mountedPath` through both
  scan paths (AST + regex, parity preserved).

  Also from the same review pass:

  - fresh projects with zero routes now still emit an empty `KickRoutes.Api`, so
    `createClient<KickRoutes.Api>` compiles before the first controller exists
  - a controller class named `Api` now triggers a typegen warning (it would
    declaration-merge into the reserved flat map)
  - duplicate-route warnings now say what they mean (a genuine runtime verb+path
    conflict) instead of firing false positives across controllers
  - client: `ShapeOf` fallback is `never` (was all-`unknown`) — generator/client
    key drift fails loudly at the call site instead of silently untyping calls
  - kickjs: `KickRoutes` doc comment updated for the `Api` member + the actual
    generated filename

- [#440](https://github.com/forinda/kick-js/pull/440) [`822490f`](https://github.com/forinda/kick-js/commit/822490f293b7616440c5c8c68476daf93d643735) Thanks [@forinda](https://github.com/forinda)! - perf: use Web Crypto (`globalThis.crypto`) instead of `node:crypto` on the request path

  `requestScopeMiddleware`, `requestId()`, `csrf()` and `traceContext()` now use
  `crypto.randomUUID()` / `crypto.getRandomValues()` — identical output, no
  `node:crypto` import. First step toward edge-runtime (WinterCG) portability;
  no behavior change on node.

## 6.1.1

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

- Updated dependencies [[`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783)]:
  - @forinda/kickjs-schema@0.1.3

## 6.1.0

### Minor Changes

- [#415](https://github.com/forinda/kick-js/pull/415) [`7864609`](https://github.com/forinda/kick-js/commit/786460934ac035a3d591d7b80d49cdfba6a64a1d) Thanks [@forinda](https://github.com/forinda)! - DevTools now surfaces the active HTTP runtime and reports uptime correctly.
  - **`Application.getActiveRuntime()`** (new) — returns `{ name, capabilities }` for the active engine (`express` / `fastify` / `h3`), so tooling can show which runtime an app runs on.
  - **DevTools `/health`** includes `runtime`; **`/runtime`** includes a `process` block (`nodeVersion`, `pid`, `platform`, `arch`, `runtime`) — the Runtime tab now shows a strip making explicit that the memory / CPU / event-loop stats are for **this Node process** (the one running your app), with the engine, Node version, platform, and pid.
  - **Uptime fix** — uptime was derived from a timestamp reset in `beforeMount`, which re-runs on every HMR rebuild / dev re-bootstrap and pinned it near `0s`. It now reads `process.uptime()`, which is monotonic from process start and survives reloads.

### Patch Changes

- [#421](https://github.com/forinda/kick-js/pull/421) [`3d877a9`](https://github.com/forinda/kick-js/commit/3d877a9cfb2ff7bea4d1fc965bd62c184ba3a957) Thanks [@forinda](https://github.com/forinda)! - assets: in dev, resolve from the live `src/` tree instead of a stale built manifest

  `assets.x.y()` / `resolveAsset()` could return stale paths (or throw
  `UnknownAssetError` for a freshly-added file) in development when an earlier
  `kick build` had left a `dist/.kickjs-assets.json` on disk. The dev resolver
  skips its in-memory cache so file additions show up live, but `discoverManifest`
  still probed on-disk built manifests (`dist`/`build`/`out`) _before_ walking the
  source tree — so the stale manifest shadowed `src/`.

  Dev now prefers a fresh source walk and only falls back to a built manifest when
  there's no `assetMap` config to walk. `KICK_ASSETS_ROOT` still wins as an
  explicit override; production behaviour is unchanged.

- [#423](https://github.com/forinda/kick-js/pull/423) [`2c705d7`](https://github.com/forinda/kick-js/commit/2c705d72a8741f46034ff178cec7625969811271) Thanks [@forinda](https://github.com/forinda)! - perf(container): skip change-event bookkeeping when no listener is attached

  `Container.resolve()` emitted a debounced change event on every call — including
  the hot cached-singleton path. With no `onChange` subscriber (the production
  default; only DevTools or tests subscribe), each resolve still scanned the
  pending batch, pushed an entry, and rescheduled a `setTimeout`, only for the
  flush to iterate an empty listener set and discard the work. `emit()` now
  short-circuits when there are zero listeners, keeping `resolve()` allocation- and
  timer-free on the common path. Behaviour is unchanged when a listener is present;
  registration counters (`resolveCount`, `lastResolvedAt`) are updated regardless.

## 6.0.1

### Patch Changes

- [#413](https://github.com/forinda/kick-js/pull/413) [`732d0f6`](https://github.com/forinda/kick-js/commit/732d0f64d8e5082b6fe8564a73ed1e8daf2c346b) Thanks [@forinda](https://github.com/forinda)! - Refresh the package README: add an HTTP Runtimes section (Express / Fastify / h3 swap), surface `kick/db` and file uploads, and fix the Common Add-Ons list — drop the deprecated `drizzle` / `prisma` entries in favour of `kick add db` / `kick add upload`, and add `kick doctor`. Also drops a stale "v5" reference.

## 6.0.0

### Major Changes

- [#402](https://github.com/forinda/kick-js/pull/402) [`f45f83c`](https://github.com/forinda/kick-js/commit/f45f83c362de15cd7f396814b0eb191a96c6c750) Thanks [@forinda](https://github.com/forinda)! - **Major release — the pluggable HTTP runtimes line.** `@forinda/kickjs` now runs on Express (default), Fastify, or h3 behind one `HttpRuntime` seam, selected with `bootstrap({ runtime })`. Express apps need no code changes (see the migration guide), but this is a major because the runtime/adapter refactor changed a few surfaces that adapter and tooling authors depend on:

  - `RequestContext` response helpers (`json`/`html`/`sse`/`download`/`render`/`problem`) now return `RuntimeResponse` instead of the Express `Response` — they write through an engine-neutral response driver.
  - `AdapterContext` gained a required `http` facade (`route`/`mount`/`serveStatic`/`use`) and `AdapterContext.app` / `getRuntimeApp()` are typed to the active runtime via the `KickRuntimeRegister` registry (Express by default).
  - `getExpressApp()` is deprecated in favour of `getRuntimeApp()`.
  - The default logger is `ConsoleLoggerProvider` (pino dropped — zero default deps).
  - The Fastify and h3 runtimes carry no `express` dependency (static serving uses `serve-static`).

  New: `@FileUpload` works on all three engines, `bootstrap({ runtime })`, the `@forinda/kickjs/fastify` and `@forinda/kickjs/h3` subpaths, cross-engine uploads, and the `KickRuntimeRegister` type registry.

### Patch Changes

- [#404](https://github.com/forinda/kick-js/pull/404) [`506f083`](https://github.com/forinda/kick-js/commit/506f083df779256a4f366a936e918da7e43a592b) Thanks [@forinda](https://github.com/forinda)! - Two HTTP-runtime route-reachability fixes surfaced by linked-build testing:

  - **h3:** routes from any source past the first 404'd (`/health`, devtools `/_debug/*`, ad-hoc adapter routes) with `Cannot find any path matching …`. h3's `createRouter` is terminal — on no match it throws rather than falling through like an Express Router — so mounting each source as its own router let the first shadow the rest. The runtime now uses one shared router per app (registered after the connect middleware), and dispatches the router's no-match 404 through `onError` to the framework's notFound handler (or the Vite dev fall-through) instead of surfacing it as a logged error.
  - **fastify:** a controller's root `@Get('/')` (mounted at the prefix) 404'd a trailing-slash request (`/api/v1/hello/`) because Fastify's router is strict by default, while Express and h3 are lenient. The runtime now sets `routerOptions.ignoreTrailingSlash`, so `${prefix}` and `${prefix}/` both resolve.

  Conformance gains multi-mount-source and root-trailing-slash cases across express + fastify + h3.

## 5.18.0

### Minor Changes

- [#395](https://github.com/forinda/kick-js/pull/395) [`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea) Thanks [@forinda](https://github.com/forinda)! - File uploads (`@FileUpload` → `ctx.file` / `ctx.files`) now work on all three runtimes, and the CLI grew runtime-aware tooling around them.

  **`@forinda/kickjs`**

  - Fastify and h3 runtimes implement file uploads (previously gated `capabilities.uploads: false`). Fastify buffers multipart parts via `@fastify/multipart` (new optional peer); h3 uses its built-in `readMultipartFormData`. Both produce the same Multer-shaped file objects as Express, so `@FileUpload` and `ctx.file` / `ctx.files` behave identically across engines. Conformance-tested under all three.
  - New shared helpers in `middleware/upload.ts`: `buildFileTypeFilter`, `applyUploadConfig` (enforces field name, type filter, per-file `maxSize`, array `maxCount`).
  - Added `HttpStatus.PAYLOAD_TOO_LARGE` (413) and `HttpStatus.UNSUPPORTED_MEDIA_TYPE` (415).
  - The runtime subpaths export their engine-native type maps: `FastifyRuntimeTypes` (`@forinda/kickjs/fastify`) and `H3RuntimeTypes` (`@forinda/kickjs/h3`), for the `KickRuntimeRegister` escape-hatch augmentation.

  **`@forinda/kickjs-cli`**

  - `KickConfig.runtime?: 'express' | 'fastify' | 'h3'` — written by `kick new --runtime`, read by dep-aware commands.
  - `kick add upload` installs the multipart driver for the project's runtime: Express → `multer` (+ `@types/multer`), Fastify → `@fastify/multipart`, h3 → none (native).
  - New `kick/runtime` typegen plugin emits the `KickRuntimeRegister` augmentation from `config.runtime`, retyping `ctx.req` / `ctx.res` / `AdapterContext.app` / `getRuntimeApp()` to the active engine (Express stays the default, no augmentation emitted).
  - `kick doctor` gains two checks: the configured runtime's engine peers are installed, and — when upload usage is detected in `src/` — the matching multipart driver is present.

- [#375](https://github.com/forinda/kick-js/pull/375) [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4) Thanks [@forinda](https://github.com/forinda)! - Add the engine-agnostic adapter HTTP facade (M2a). `AdapterContext` now carries `http: AdapterHttp` — `route()` / `mount()` / `serveStatic()` / `use()` — the supported way for adapters to register routes, mounts, static dirs, and middleware without reaching for the raw Express `app`. Each call routes through the active `HttpRuntime`, so an adapter written against `ctx.http` works under any runtime.

  `ctx.app` stays as the engine-native escape hatch (Express under the default runtime). Existing adapters that use `ctx.app` are unchanged. Migrating the first-party adapters (swagger / queue / mcp / devtools) onto `ctx.http` follows in M2b/M2c.

  Note: `http` is a required field on `AdapterContext` (like `app`), so code that hand-builds a mock `AdapterContext` (e.g. in tests) must now include an `http` entry.

  `RouteMeta.controller` / `handlerName` are now optional (ad-hoc routes registered via `ctx.http.route` have no controller behind them).

- [#377](https://github.com/forinda/kick-js/pull/377) [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1) Thanks [@forinda](https://github.com/forinda)! - Migrate the queue and mcp adapters onto the engine-agnostic `ctx.http` facade (M2b), and export the `AdapterHttp` type from `@forinda/kickjs` so adapter authors can type against it.

  - `@forinda/kickjs-queue`: the `/_kick/queue/{panel,data}` routes now register via `ctx.http.route(...)` and respond through `ctx.html` / `ctx.json` instead of reaching for the raw Express `app` / `res`.
  - `@forinda/kickjs-mcp`: the StreamableHTTP transport endpoints (`<basePath>/messages`) now mount via `ctx.http.mount(...)` — all three verbs in one route table so the engine still auto-answers the OPTIONS preflight. The transport handler reaches `ctx.req` / `ctx.res` for the raw node request/response it needs.

  Behavior is unchanged under the default Express runtime. Swagger and devtools migrate in M2c.

- [#372](https://github.com/forinda/kick-js/pull/372) [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8) Thanks [@forinda](https://github.com/forinda)! - Route the bootstrap path through the HTTP-runtime seam (M1b). `Application` now holds an `HttpRuntime` (default `expressRuntime()`) and drives it for app creation, every middleware registration, route mounting, the terminal not-found / error handlers, the production server, and HMR rebuilds — instead of calling Express directly. The new `ApplicationOptions.runtime` lets you supply a different engine driver.

  No behavior change: Express stays the zero-config default, so existing apps are byte-for-byte unaffected (full suite passes untouched). Engine-native escape hatches (`getExpressApp()`, `AdapterContext.app`, the health-check routes) still resolve to the Express app under the default runtime; moving those onto the runtime's adapter facade is the next milestone (M2).

  This makes the runtime load-bearing — the foundation the Fastify / h3 subpaths plug into later.

- [#384](https://github.com/forinda/kick-js/pull/384) [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c) Thanks [@forinda](https://github.com/forinda)! - Add the **Fastify runtime** — `@forinda/kickjs/fastify` (M3c). Pick the engine at bootstrap with no controller, module, or context-decorator changes:

  ```ts
  import { fastifyRuntime } from "@forinda/kickjs/fastify";
  export const app = await bootstrap({ modules, runtime: fastifyRuntime() });
  ```

  - `fastifyRuntime()` implements the full `HttpRuntime` contract over Fastify 5: routes materialize as **native Fastify routes**, `reply` is wrapped in a `RuntimeResponse` so `ctx.json` / `ctx.html` / `ctx.download` / `ctx.problem` work unchanged, and connect middleware (the built-ins + adopter middleware) runs via `@fastify/middie`. Per spec §10, Fastify's built-in pino logger is disabled (`logger: false`) so the kickjs `requestLogger` stays the single log format.
  - `fastify` and `@fastify/middie` are **optional peers** (install only when you opt in); the root package never imports them unless this subpath is used.
  - `Application` now mounts controller routes through the runtime's engine-neutral `mountRoutes(RouteTable)` instead of always building an Express `Router` — behavior is byte-identical under the default Express runtime (verified by the full suite). Hand-built `route.router` values stay Express-specific and mount as connect middleware.

  A conformance suite runs one fixture app under **both** Express and Fastify (routing, the response driver, connect middleware). Express behavior is unchanged.

  Known follow-ups (next M3 steps): request-scoped contributors under Fastify (ALS frame across its hook model), `@fastify/multipart` uploads, SSE conformance, the `kick/runtime` typegen plugin, and widening `ApplicationOptions.runtime` from `HttpRuntime<Express>` to generic.

- [#390](https://github.com/forinda/kick-js/pull/390) [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd) Thanks [@forinda](https://github.com/forinda)! - Add the **h3 runtime** — `@forinda/kickjs/h3` (M4). h3 is the HTTP layer behind Nitro / Nuxt; KickJS now runs on it with no controller or module changes:

  ```ts
  import { h3Runtime } from "@forinda/kickjs/h3";
  export const app = await bootstrap({ modules, runtime: h3Runtime() });
  ```

  `h3Runtime()` implements the full `HttpRuntime` contract over **h3 v1** (the stable, node-based surface — `createApp` / `createRouter` / `toNodeListener`, with `event.node.req` / `event.node.res`). Routes become native h3 router routes; the node response is wrapped in a `RuntimeResponse` so `ctx.json` / `ctx.html` / `ctx.sse` work unchanged; connect middleware runs via h3's `fromNodeMiddleware`; bodies parse natively (`readBody`).

  `h3` is an **optional peer** (`^1`); the root package never loads it unless this subpath is used. The conformance suite now runs the same fixture app under **Express, Fastify, and h3** (24 cases) — routing, the response driver, connect middleware, context decorators, errors / 404, SSE, and validation all pass on all three.

  h3 v2's web-standard `Request` / `Response` core is the eventual target via a future web-standard driver (spec §8); until then this binding uses the node-compatible v1 surface. File uploads remain gated (`capability: false`) on Fastify and h3.

- [#381](https://github.com/forinda/kick-js/pull/381) [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91) Thanks [@forinda](https://github.com/forinda)! - Add the runtime-typed escape-hatch registry (M3a, spec §4.3b) — the type foundation the Fastify / h3 runtimes plug into.

  - New augmentable `KickRuntimeRegister` interface plus `RuntimeTypeMap`, `ExpressRuntimeTypes`, and the `ActiveRuntime` resolver. With no augmentation, `ActiveRuntime` defaults to the Express type map.
  - `AdapterContext.app` and the new `getRuntimeApp()` accessor are now typed `ActiveRuntime['app']` (Express by default), so a `kick/runtime` typegen augmentation can flip the engine-native escape-hatch types to Fastify / h3 without touching adapter code. `getExpressApp()` stays as a deprecated alias.

  Mirrors the `KickDbRegister` / `KickEnv` augmentation mechanism. Zero behavior change and — under the default Express runtime — zero type change (`ActiveRuntime['app']` is `Express`). The request/response driver layer (`ctx.req.raw` / `ctx.res.raw`) and the Fastify runtime itself follow in later M3 steps.

- [#382](https://github.com/forinda/kick-js/pull/382) [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25) Thanks [@forinda](https://github.com/forinda)! - Route `RequestContext`'s response helpers through an engine-agnostic `RuntimeResponse` driver (M3b) instead of calling Express `res` methods directly — the first half of the request/response driver layer that lets `ctx` run on non-Express engines.

  - New `RuntimeResponse` interface (exported), sized so `express.Response` satisfies it structurally. Under the Express runtime the driver IS the response object, so there is no wrapping and no behavior change.
  - `RequestContext` gains an optional fourth constructor argument (`responseDriver`); when omitted it defaults to `res`, so every existing `new RequestContext(req, res, next)` call is unchanged. Fastify / h3 runtimes will pass a thin wrapper over their native reply.
  - `ctx.json` / `ctx.html` / `ctx.download` / `ctx.render` / `ctx.problem.*` and `ctx.sse()` now write through the driver; their return type is `RuntimeResponse` (Express's `Response` is a superset, so chained `.status().json()` usage keeps working).

  Behavior is unchanged under the default Express runtime (full kickjs suite + testing/swagger/mcp/devtools pass). `ctx.req` / `ctx.res` stay as the raw engine objects; retyping them via the runtime registry and the Fastify runtime itself follow in M3c.

- [#370](https://github.com/forinda/kick-js/pull/370) [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215) Thanks [@forinda](https://github.com/forinda)! - Introduce the pluggable HTTP-runtime seam (M1 — seam extraction). Decorators no longer emit an `express.Router` directly: `buildRouteTable()` turns controller metadata into a plain-data `RouteEntry[]`, and an `HttpRuntime` materializes that table onto its engine. `expressRuntime()` is the default and the reference implementation — its materializer rebuilds the exact handler chain the old router builder produced, so behavior is unchanged (the full existing suite passes untouched).

  New exports from `@forinda/kickjs`: `expressRuntime`, `buildRouteTable`, `materializeRouter`, and the `HttpRuntime` / `RouteTable` / `RouteEntry` / `RouteMeta` / `CtxHandler` / `ConnectMiddleware` / `RuntimeAppOptions` / `RuntimeCapabilities` types. The public `buildRoutes(controller)` API is unchanged — it now delegates through the Express runtime.

  No behavior change and no migration required. This is the foundation for the Fastify / h3 runtimes in later milestones (see `docs/http/spec-http-runtimes.md`).

- [#399](https://github.com/forinda/kick-js/pull/399) [`2481bfd`](https://github.com/forinda/kick-js/commit/2481bfd0c9bf6418dcd04a5efedfc96974beb19f) Thanks [@forinda](https://github.com/forinda)! - The Fastify and h3 runtimes no longer depend on `express`. Their `serveStatic` used `express.static`, which forced `express` to be installed even on a pure Fastify/h3 app — defeating the point of swapping the engine. They now use `serve-static` (the standalone connect middleware that `express.static` wraps), bridged through middie / `fromNodeMiddleware` exactly as before. `serve-static` is a new optional peer of `@forinda/kickjs`.

  CLI scaffolding follows suit: `kick new --runtime fastify|h3` now installs `serve-static` instead of `express` (and drops the `@types/express` devDependency) — an Express scaffold still gets `express`. The alpha-channel pins for the runtime toolchain (`@forinda/kickjs`, `-cli`, `-vite`) are now `^`-ranges rather than exact versions, so a generated project floats to newer alphas and auto-graduates to the stable release once it ships.

### Patch Changes

- [#385](https://github.com/forinda/kick-js/pull/385) [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17) Thanks [@forinda](https://github.com/forinda)! - Make request-scoped contributors and `ctx.set` / `ctx.get` work under the Fastify runtime. Fastify runs the route handler outside the connect-middleware chain, so the `requestScopeMiddleware` AsyncLocalStorage frame (which Express relies on) wasn't active inside the handler. The Fastify route handler now establishes the ALS frame itself around the pipeline (reusing the inbound `x-request-id` when present), so REQUEST-scoped DI, context decorators (`defineContextDecorator`), and `ctx.set` / `ctx.get` behave the same on Fastify as on Express. Adds a shared `createRequestStore` helper (used by both the Express middleware and the Fastify runtime) and a conformance test covering contributors under both engines.

- [#386](https://github.com/forinda/kick-js/pull/386) [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5) Thanks [@forinda](https://github.com/forinda)! - Error handling, 404s, and Server-Sent Events now work under the Fastify runtime.

  - **Errors / 404**: the Fastify runtime passed the raw node response to the connect-style `errorHandler` / `notFoundHandler`, whose `res.status().json()` calls failed on it. They now receive the `RuntimeResponse` reply driver, so thrown errors map to the proper 500 / problem response and unmatched routes return the standard 404 — same shape as Express.
  - **SSE / `ctx.signal`**: `ctx.sse()` and `ctx.signal` register `req.on('close')` / `req.once('close')`, which Fastify's request object doesn't expose. The runtime now hands `ctx` the raw node request (which has the stream events) with Fastify's parsed `body` / `params` / `query` copied onto it, so streaming and request accessors both work.

  The conformance suite now runs error, 404, and SSE cases under **both** Express and Fastify (14 cases total).

- [#389](https://github.com/forinda/kick-js/pull/389) [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7) Thanks [@forinda](https://github.com/forinda)! - Validation and request-body parsing now work under the Fastify runtime.

  - **Validation**: the Fastify route handler now runs the route's `@Get(path, schema)` / `route.validation` schema (it previously skipped it, so validated routes weren't actually validated on Fastify). `validate` is a connect-style middleware that parses `req.body` / `query` / `params` and rejects via `next(err)` → a 422 through the error handler — same as Express.
  - **Body parsing**: a new `nativeBodyParsing` runtime capability. Fastify parses bodies itself, so the Application now skips its default `express.json()` on Fastify — previously both ran, the body stream was read twice, and the request hung. Express keeps `express.json()` (capability is `false`).
  - **Root paths**: a controller `@Post('/')` now mounts at the module prefix itself on Fastify (not `${prefix}/`), so requests without a trailing slash match.

  Conformance suite now covers body validation (valid → parsed, invalid → rejected) under both Express and Fastify. kickjs 572 green.

- [#383](https://github.com/forinda/kick-js/pull/383) [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975) Thanks [@forinda](https://github.com/forinda)! - Type `ctx.req` / `ctx.res` from the runtime registry (`ActiveRuntime['request']` / `ActiveRuntime['response']`) instead of hard-coding Express's `Request` / `Response`. Under the default (unaugmented) Express runtime these resolve to `express.Request` / `express.Response`, so there is no change for existing apps — but a `kick/runtime` typegen augmentation now flips `ctx.req` / `ctx.res` to the active engine's native request/response, completing the §4.3b runtime-typed-context story for the request context. Behavior is unchanged; this is the last type-prep before the Fastify runtime subpath.

- [#380](https://github.com/forinda/kick-js/pull/380) [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5) Thanks [@forinda](https://github.com/forinda)! - Move the Application's last Express-specific calls onto the HTTP runtime, so `application.ts` no longer reaches for engine-specific APIs in its setup path:

  - `disable('x-powered-by')` + `set('trust proxy')` now live in `expressRuntime.createApp(opts)`; `Application` passes `trustProxy` through at both the constructor and HMR-rebuild create sites. `RuntimeAppOptions.trustProxy` widened to include Express's function form.
  - The `/health/live` and `/health/ready` endpoints now register through the `ctx.http` facade instead of `this.app.get(...)`.

  Behavior is unchanged under the default Express runtime. The engine-native escape hatches (`getExpressApp()` / `getRuntimeApp()`, `AdapterContext.app`) stay typed `Express` — `ApplicationOptions.runtime` widens from `HttpRuntime<Express>` to generic once `app` becomes runtime-typed (with the Fastify / h3 work).

- [#387](https://github.com/forinda/kick-js/pull/387) [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78) Thanks [@forinda](https://github.com/forinda)! - `ApplicationOptions.runtime` now accepts any `HttpRuntime`, so `bootstrap({ runtime: fastifyRuntime() })` typechecks without a cast. It was previously typed `HttpRuntime<Express>`, which forced a `as never` / `as any` when passing a non-Express runtime. The engine-native escape hatches (`getRuntimeApp()`, `AdapterContext.app`) continue to follow the active runtime via the `ActiveRuntime` registry (Express by default). Behavior is unchanged.

## 5.18.0-alpha.1

### Minor Changes

- [#399](https://github.com/forinda/kick-js/pull/399) [`2481bfd`](https://github.com/forinda/kick-js/commit/2481bfd0c9bf6418dcd04a5efedfc96974beb19f) Thanks [@forinda](https://github.com/forinda)! - The Fastify and h3 runtimes no longer depend on `express`. Their `serveStatic` used `express.static`, which forced `express` to be installed even on a pure Fastify/h3 app — defeating the point of swapping the engine. They now use `serve-static` (the standalone connect middleware that `express.static` wraps), bridged through middie / `fromNodeMiddleware` exactly as before. `serve-static` is a new optional peer of `@forinda/kickjs`.

  CLI scaffolding follows suit: `kick new --runtime fastify|h3` now installs `serve-static` instead of `express` (and drops the `@types/express` devDependency) — an Express scaffold still gets `express`. The alpha-channel pins for the runtime toolchain (`@forinda/kickjs`, `-cli`, `-vite`) are now `^`-ranges rather than exact versions, so a generated project floats to newer alphas and auto-graduates to the stable release once it ships.

## 5.18.0-alpha.0

### Minor Changes

- [#395](https://github.com/forinda/kick-js/pull/395) [`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea) Thanks [@forinda](https://github.com/forinda)! - File uploads (`@FileUpload` → `ctx.file` / `ctx.files`) now work on all three runtimes, and the CLI grew runtime-aware tooling around them.

  **`@forinda/kickjs`**

  - Fastify and h3 runtimes implement file uploads (previously gated `capabilities.uploads: false`). Fastify buffers multipart parts via `@fastify/multipart` (new optional peer); h3 uses its built-in `readMultipartFormData`. Both produce the same Multer-shaped file objects as Express, so `@FileUpload` and `ctx.file` / `ctx.files` behave identically across engines. Conformance-tested under all three.
  - New shared helpers in `middleware/upload.ts`: `buildFileTypeFilter`, `applyUploadConfig` (enforces field name, type filter, per-file `maxSize`, array `maxCount`).
  - Added `HttpStatus.PAYLOAD_TOO_LARGE` (413) and `HttpStatus.UNSUPPORTED_MEDIA_TYPE` (415).
  - The runtime subpaths export their engine-native type maps: `FastifyRuntimeTypes` (`@forinda/kickjs/fastify`) and `H3RuntimeTypes` (`@forinda/kickjs/h3`), for the `KickRuntimeRegister` escape-hatch augmentation.

  **`@forinda/kickjs-cli`**

  - `KickConfig.runtime?: 'express' | 'fastify' | 'h3'` — written by `kick new --runtime`, read by dep-aware commands.
  - `kick add upload` installs the multipart driver for the project's runtime: Express → `multer` (+ `@types/multer`), Fastify → `@fastify/multipart`, h3 → none (native).
  - New `kick/runtime` typegen plugin emits the `KickRuntimeRegister` augmentation from `config.runtime`, retyping `ctx.req` / `ctx.res` / `AdapterContext.app` / `getRuntimeApp()` to the active engine (Express stays the default, no augmentation emitted).
  - `kick doctor` gains two checks: the configured runtime's engine peers are installed, and — when upload usage is detected in `src/` — the matching multipart driver is present.

- [#375](https://github.com/forinda/kick-js/pull/375) [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4) Thanks [@forinda](https://github.com/forinda)! - Add the engine-agnostic adapter HTTP facade (M2a). `AdapterContext` now carries `http: AdapterHttp` — `route()` / `mount()` / `serveStatic()` / `use()` — the supported way for adapters to register routes, mounts, static dirs, and middleware without reaching for the raw Express `app`. Each call routes through the active `HttpRuntime`, so an adapter written against `ctx.http` works under any runtime.

  `ctx.app` stays as the engine-native escape hatch (Express under the default runtime). Existing adapters that use `ctx.app` are unchanged. Migrating the first-party adapters (swagger / queue / mcp / devtools) onto `ctx.http` follows in M2b/M2c.

  Note: `http` is a required field on `AdapterContext` (like `app`), so code that hand-builds a mock `AdapterContext` (e.g. in tests) must now include an `http` entry.

  `RouteMeta.controller` / `handlerName` are now optional (ad-hoc routes registered via `ctx.http.route` have no controller behind them).

- [#377](https://github.com/forinda/kick-js/pull/377) [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1) Thanks [@forinda](https://github.com/forinda)! - Migrate the queue and mcp adapters onto the engine-agnostic `ctx.http` facade (M2b), and export the `AdapterHttp` type from `@forinda/kickjs` so adapter authors can type against it.

  - `@forinda/kickjs-queue`: the `/_kick/queue/{panel,data}` routes now register via `ctx.http.route(...)` and respond through `ctx.html` / `ctx.json` instead of reaching for the raw Express `app` / `res`.
  - `@forinda/kickjs-mcp`: the StreamableHTTP transport endpoints (`<basePath>/messages`) now mount via `ctx.http.mount(...)` — all three verbs in one route table so the engine still auto-answers the OPTIONS preflight. The transport handler reaches `ctx.req` / `ctx.res` for the raw node request/response it needs.

  Behavior is unchanged under the default Express runtime. Swagger and devtools migrate in M2c.

- [#372](https://github.com/forinda/kick-js/pull/372) [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8) Thanks [@forinda](https://github.com/forinda)! - Route the bootstrap path through the HTTP-runtime seam (M1b). `Application` now holds an `HttpRuntime` (default `expressRuntime()`) and drives it for app creation, every middleware registration, route mounting, the terminal not-found / error handlers, the production server, and HMR rebuilds — instead of calling Express directly. The new `ApplicationOptions.runtime` lets you supply a different engine driver.

  No behavior change: Express stays the zero-config default, so existing apps are byte-for-byte unaffected (full suite passes untouched). Engine-native escape hatches (`getExpressApp()`, `AdapterContext.app`, the health-check routes) still resolve to the Express app under the default runtime; moving those onto the runtime's adapter facade is the next milestone (M2).

  This makes the runtime load-bearing — the foundation the Fastify / h3 subpaths plug into later.

- [#384](https://github.com/forinda/kick-js/pull/384) [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c) Thanks [@forinda](https://github.com/forinda)! - Add the **Fastify runtime** — `@forinda/kickjs/fastify` (M3c). Pick the engine at bootstrap with no controller, module, or context-decorator changes:

  ```ts
  import { fastifyRuntime } from "@forinda/kickjs/fastify";
  export const app = await bootstrap({ modules, runtime: fastifyRuntime() });
  ```

  - `fastifyRuntime()` implements the full `HttpRuntime` contract over Fastify 5: routes materialize as **native Fastify routes**, `reply` is wrapped in a `RuntimeResponse` so `ctx.json` / `ctx.html` / `ctx.download` / `ctx.problem` work unchanged, and connect middleware (the built-ins + adopter middleware) runs via `@fastify/middie`. Per spec §10, Fastify's built-in pino logger is disabled (`logger: false`) so the kickjs `requestLogger` stays the single log format.
  - `fastify` and `@fastify/middie` are **optional peers** (install only when you opt in); the root package never imports them unless this subpath is used.
  - `Application` now mounts controller routes through the runtime's engine-neutral `mountRoutes(RouteTable)` instead of always building an Express `Router` — behavior is byte-identical under the default Express runtime (verified by the full suite). Hand-built `route.router` values stay Express-specific and mount as connect middleware.

  A conformance suite runs one fixture app under **both** Express and Fastify (routing, the response driver, connect middleware). Express behavior is unchanged.

  Known follow-ups (next M3 steps): request-scoped contributors under Fastify (ALS frame across its hook model), `@fastify/multipart` uploads, SSE conformance, the `kick/runtime` typegen plugin, and widening `ApplicationOptions.runtime` from `HttpRuntime<Express>` to generic.

- [#390](https://github.com/forinda/kick-js/pull/390) [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd) Thanks [@forinda](https://github.com/forinda)! - Add the **h3 runtime** — `@forinda/kickjs/h3` (M4). h3 is the HTTP layer behind Nitro / Nuxt; KickJS now runs on it with no controller or module changes:

  ```ts
  import { h3Runtime } from "@forinda/kickjs/h3";
  export const app = await bootstrap({ modules, runtime: h3Runtime() });
  ```

  `h3Runtime()` implements the full `HttpRuntime` contract over **h3 v1** (the stable, node-based surface — `createApp` / `createRouter` / `toNodeListener`, with `event.node.req` / `event.node.res`). Routes become native h3 router routes; the node response is wrapped in a `RuntimeResponse` so `ctx.json` / `ctx.html` / `ctx.sse` work unchanged; connect middleware runs via h3's `fromNodeMiddleware`; bodies parse natively (`readBody`).

  `h3` is an **optional peer** (`^1`); the root package never loads it unless this subpath is used. The conformance suite now runs the same fixture app under **Express, Fastify, and h3** (24 cases) — routing, the response driver, connect middleware, context decorators, errors / 404, SSE, and validation all pass on all three.

  h3 v2's web-standard `Request` / `Response` core is the eventual target via a future web-standard driver (spec §8); until then this binding uses the node-compatible v1 surface. File uploads remain gated (`capability: false`) on Fastify and h3.

- [#381](https://github.com/forinda/kick-js/pull/381) [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91) Thanks [@forinda](https://github.com/forinda)! - Add the runtime-typed escape-hatch registry (M3a, spec §4.3b) — the type foundation the Fastify / h3 runtimes plug into.

  - New augmentable `KickRuntimeRegister` interface plus `RuntimeTypeMap`, `ExpressRuntimeTypes`, and the `ActiveRuntime` resolver. With no augmentation, `ActiveRuntime` defaults to the Express type map.
  - `AdapterContext.app` and the new `getRuntimeApp()` accessor are now typed `ActiveRuntime['app']` (Express by default), so a `kick/runtime` typegen augmentation can flip the engine-native escape-hatch types to Fastify / h3 without touching adapter code. `getExpressApp()` stays as a deprecated alias.

  Mirrors the `KickDbRegister` / `KickEnv` augmentation mechanism. Zero behavior change and — under the default Express runtime — zero type change (`ActiveRuntime['app']` is `Express`). The request/response driver layer (`ctx.req.raw` / `ctx.res.raw`) and the Fastify runtime itself follow in later M3 steps.

- [#382](https://github.com/forinda/kick-js/pull/382) [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25) Thanks [@forinda](https://github.com/forinda)! - Route `RequestContext`'s response helpers through an engine-agnostic `RuntimeResponse` driver (M3b) instead of calling Express `res` methods directly — the first half of the request/response driver layer that lets `ctx` run on non-Express engines.

  - New `RuntimeResponse` interface (exported), sized so `express.Response` satisfies it structurally. Under the Express runtime the driver IS the response object, so there is no wrapping and no behavior change.
  - `RequestContext` gains an optional fourth constructor argument (`responseDriver`); when omitted it defaults to `res`, so every existing `new RequestContext(req, res, next)` call is unchanged. Fastify / h3 runtimes will pass a thin wrapper over their native reply.
  - `ctx.json` / `ctx.html` / `ctx.download` / `ctx.render` / `ctx.problem.*` and `ctx.sse()` now write through the driver; their return type is `RuntimeResponse` (Express's `Response` is a superset, so chained `.status().json()` usage keeps working).

  Behavior is unchanged under the default Express runtime (full kickjs suite + testing/swagger/mcp/devtools pass). `ctx.req` / `ctx.res` stay as the raw engine objects; retyping them via the runtime registry and the Fastify runtime itself follow in M3c.

- [#370](https://github.com/forinda/kick-js/pull/370) [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215) Thanks [@forinda](https://github.com/forinda)! - Introduce the pluggable HTTP-runtime seam (M1 — seam extraction). Decorators no longer emit an `express.Router` directly: `buildRouteTable()` turns controller metadata into a plain-data `RouteEntry[]`, and an `HttpRuntime` materializes that table onto its engine. `expressRuntime()` is the default and the reference implementation — its materializer rebuilds the exact handler chain the old router builder produced, so behavior is unchanged (the full existing suite passes untouched).

  New exports from `@forinda/kickjs`: `expressRuntime`, `buildRouteTable`, `materializeRouter`, and the `HttpRuntime` / `RouteTable` / `RouteEntry` / `RouteMeta` / `CtxHandler` / `ConnectMiddleware` / `RuntimeAppOptions` / `RuntimeCapabilities` types. The public `buildRoutes(controller)` API is unchanged — it now delegates through the Express runtime.

  No behavior change and no migration required. This is the foundation for the Fastify / h3 runtimes in later milestones (see `docs/http/spec-http-runtimes.md`).

### Patch Changes

- [#385](https://github.com/forinda/kick-js/pull/385) [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17) Thanks [@forinda](https://github.com/forinda)! - Make request-scoped contributors and `ctx.set` / `ctx.get` work under the Fastify runtime. Fastify runs the route handler outside the connect-middleware chain, so the `requestScopeMiddleware` AsyncLocalStorage frame (which Express relies on) wasn't active inside the handler. The Fastify route handler now establishes the ALS frame itself around the pipeline (reusing the inbound `x-request-id` when present), so REQUEST-scoped DI, context decorators (`defineContextDecorator`), and `ctx.set` / `ctx.get` behave the same on Fastify as on Express. Adds a shared `createRequestStore` helper (used by both the Express middleware and the Fastify runtime) and a conformance test covering contributors under both engines.

- [#386](https://github.com/forinda/kick-js/pull/386) [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5) Thanks [@forinda](https://github.com/forinda)! - Error handling, 404s, and Server-Sent Events now work under the Fastify runtime.

  - **Errors / 404**: the Fastify runtime passed the raw node response to the connect-style `errorHandler` / `notFoundHandler`, whose `res.status().json()` calls failed on it. They now receive the `RuntimeResponse` reply driver, so thrown errors map to the proper 500 / problem response and unmatched routes return the standard 404 — same shape as Express.
  - **SSE / `ctx.signal`**: `ctx.sse()` and `ctx.signal` register `req.on('close')` / `req.once('close')`, which Fastify's request object doesn't expose. The runtime now hands `ctx` the raw node request (which has the stream events) with Fastify's parsed `body` / `params` / `query` copied onto it, so streaming and request accessors both work.

  The conformance suite now runs error, 404, and SSE cases under **both** Express and Fastify (14 cases total).

- [#389](https://github.com/forinda/kick-js/pull/389) [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7) Thanks [@forinda](https://github.com/forinda)! - Validation and request-body parsing now work under the Fastify runtime.

  - **Validation**: the Fastify route handler now runs the route's `@Get(path, schema)` / `route.validation` schema (it previously skipped it, so validated routes weren't actually validated on Fastify). `validate` is a connect-style middleware that parses `req.body` / `query` / `params` and rejects via `next(err)` → a 422 through the error handler — same as Express.
  - **Body parsing**: a new `nativeBodyParsing` runtime capability. Fastify parses bodies itself, so the Application now skips its default `express.json()` on Fastify — previously both ran, the body stream was read twice, and the request hung. Express keeps `express.json()` (capability is `false`).
  - **Root paths**: a controller `@Post('/')` now mounts at the module prefix itself on Fastify (not `${prefix}/`), so requests without a trailing slash match.

  Conformance suite now covers body validation (valid → parsed, invalid → rejected) under both Express and Fastify. kickjs 572 green.

- [#383](https://github.com/forinda/kick-js/pull/383) [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975) Thanks [@forinda](https://github.com/forinda)! - Type `ctx.req` / `ctx.res` from the runtime registry (`ActiveRuntime['request']` / `ActiveRuntime['response']`) instead of hard-coding Express's `Request` / `Response`. Under the default (unaugmented) Express runtime these resolve to `express.Request` / `express.Response`, so there is no change for existing apps — but a `kick/runtime` typegen augmentation now flips `ctx.req` / `ctx.res` to the active engine's native request/response, completing the §4.3b runtime-typed-context story for the request context. Behavior is unchanged; this is the last type-prep before the Fastify runtime subpath.

- [#380](https://github.com/forinda/kick-js/pull/380) [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5) Thanks [@forinda](https://github.com/forinda)! - Move the Application's last Express-specific calls onto the HTTP runtime, so `application.ts` no longer reaches for engine-specific APIs in its setup path:

  - `disable('x-powered-by')` + `set('trust proxy')` now live in `expressRuntime.createApp(opts)`; `Application` passes `trustProxy` through at both the constructor and HMR-rebuild create sites. `RuntimeAppOptions.trustProxy` widened to include Express's function form.
  - The `/health/live` and `/health/ready` endpoints now register through the `ctx.http` facade instead of `this.app.get(...)`.

  Behavior is unchanged under the default Express runtime. The engine-native escape hatches (`getExpressApp()` / `getRuntimeApp()`, `AdapterContext.app`) stay typed `Express` — `ApplicationOptions.runtime` widens from `HttpRuntime<Express>` to generic once `app` becomes runtime-typed (with the Fastify / h3 work).

- [#387](https://github.com/forinda/kick-js/pull/387) [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78) Thanks [@forinda](https://github.com/forinda)! - `ApplicationOptions.runtime` now accepts any `HttpRuntime`, so `bootstrap({ runtime: fastifyRuntime() })` typechecks without a cast. It was previously typed `HttpRuntime<Express>`, which forced a `as never` / `as any` when passing a non-Express runtime. The engine-native escape hatches (`getRuntimeApp()`, `AdapterContext.app`) continue to follow the active runtime via the `ActiveRuntime` registry (Express by default). Behavior is unchanged.

## 5.17.0

### Minor Changes

- [#363](https://github.com/forinda/kick-js/pull/363) [`b11a837`](https://github.com/forinda/kick-js/commit/b11a83773e84299e52fbb1b74533b3986972a3bc) Thanks [@forinda](https://github.com/forinda)! - Query parsing gains an `onReject` hook, configurable limits, and `ctx.qs()` memoization.
  - `parseQuery(query, fieldConfig, options?)` accepts a new `ParseQueryOptions` bag: `maxLimit`, `defaultLimit`, `maxSearchLength`, and `onReject`. The historical silent drop of an unknown filter/sort field — or a truncated search string — now fires `onReject({ kind, field, reason })` so callers can warn, count, or return a 400. Fully backward compatible (the 2-arg form is unchanged).
  - `setQueryParsingDefaults({ maxLimit, defaultLimit, maxSearchLength })` replaces the previously hardcoded `MAX_LIMIT = 100` / `MAX_SEARCH_LENGTH = 200` constants with a one-time global override at bootstrap; per-call options still win.
  - `ctx.qs(fieldConfig, options?)` threads the options through, **memoizes** the result per request (repeat calls with the same args skip re-parsing), and by default logs rejected fields via `console.warn` with the request id — pass an explicit `onReject` (e.g. one that throws) to override, or `() => {}` to silence.

## 5.16.0

### Minor Changes

- [#328](https://github.com/forinda/kick-js/pull/328) [`bcada77`](https://github.com/forinda/kick-js/commit/bcada7784a2e866a512c25856ff1c94ca44ed92b) Thanks [@forinda](https://github.com/forinda)! - Quieter startup by default, plus clearer bootstrap option names.

  - **`ConsoleLoggerProvider` now respects `LOG_LEVEL`** (default `info`). Previously every `logger.debug()` printed unconditionally, dumping DI wiring and HMR ticks on each start. Messages below the threshold (`trace < debug < info < warn < error < fatal`, plus `silent`) are now dropped; run with `LOG_LEVEL=debug` to see them. Custom `LoggerProvider` implementations (pino, winston, …) are unaffected — they manage their own levels.

  - **The startup route table is now opt-in via `bootstrap({ logRouteTable: true })`** and defaults to **off**. It previously printed automatically in non-production. When enabled it logs at `info` level (so it appears whenever `LOG_LEVEL` permits `info`, i.e. the default). The old `logRoutesTable` option keeps working as a deprecated alias (`logRouteTable` wins when both are set).

  - **`bootstrap({ middlewares: [...] })`** is the new plural option name for the global middleware pipeline. The singular `middleware` is kept as a deprecated alias (`middlewares` wins when both are set), so existing apps keep working.

## 5.15.1

### Patch Changes

- [#321](https://github.com/forinda/kick-js/pull/321) [`5dc5a99`](https://github.com/forinda/kick-js/commit/5dc5a991df7c92dd7c369f6f87a3b005ba3dea13) Thanks [@forinda](https://github.com/forinda)! - Fix two `kick dev` (Vite) lifecycle gaps — neither was Windows-specific, though Windows made the shutdown one worse.
  - **App now bootstraps at startup, not on first request.** The dev-server plugin evaluated the app lazily via `ssrLoadModule` inside the request middleware, so `bootstrap()`, adapter `afterStart`, and your startup logs didn't run until the first HTTP request hit. The plugin now warms the module once the HTTP server is listening, so `kick dev` behaves like `node`/`tsx` — logs + adapters + the server come up immediately.
  - **Graceful shutdown now runs on Ctrl+C in dev.** The app deliberately suppresses its own SIGINT/SIGTERM handlers in dev (Vite owns the lifecycle), and the CLI dev server only closed Vite — so `adapter.shutdown()`, request draining, and shutdown logs never ran. `Application.start()` now exposes its `shutdown()` on `globalThis` in dev, and `kick dev` awaits it before tearing down Vite. Also wires `SIGBREAK` (Windows Ctrl+Break) since Windows never raises `SIGTERM`.

## 5.15.0

### Minor Changes

- [#311](https://github.com/forinda/kick-js/pull/311) [`90299cf`](https://github.com/forinda/kick-js/commit/90299cf76e6aa81776ed109db93ec5dcefea68c7) Thanks [@forinda](https://github.com/forinda)! - Add a `ContextKeys` registry so augmenting `ContextMeta` no longer breaks `dependsOn` on unrelated context decorators.

  `ContextMeta` was doing double duty: the value-type registry for `ctx.get`/`set` AND (via `keyof ContextMeta`) the valid-key registry for `dependsOn`. So the moment a project augmented `ContextMeta` for some keys, any contributor that `dependsOn`-ed a key you hadn't added to `ContextMeta` stopped compiling (`Type '"session"' is not assignable to type '"tenant" | "user"'`) — even though it was a perfectly valid contributor key.

  `dependsOn` is now typed against the **union** of `keyof ContextMeta` and the new key-only `ContextKeys` registry:

  ```ts
  declare module "@forinda/kickjs" {
    interface ContextMeta {
      tenant: { id: string; name: string };
    } // typed ctx.get
    interface ContextKeys {
      session: true;
    } // dependsOn-able, value stays unknown
  }
  ```

  Adding a value type via `ContextMeta` now always makes that key a valid `dependsOn` target, and you can register a dependsOn-able key without inventing a value type for it. Typo-protection and the empty-registry `string` fallback are preserved. Non-breaking: existing `ContextMeta`-only projects keep working unchanged.

### Patch Changes

- [#310](https://github.com/forinda/kick-js/pull/310) [`80e0fdf`](https://github.com/forinda/kick-js/commit/80e0fdf30d3d1b7e5d749cb015f77891847eefa6) Thanks [@forinda](https://github.com/forinda)! - Deprecate `defineAugmentation`. It's a no-op at both runtime and the type level — the `declare module '@forinda/kickjs' { … }` block alone provides the augmentation, and the `.kickjs/types/kick__augmentations.d.ts` catalogue it feeds is documentation-only. Prefer a plain `declare module` block with a JSDoc comment on your own interface. `defineAugmentation` and the `kick/augmentations` typegen plugin will be removed in a future major; no behaviour change for now.

- [#307](https://github.com/forinda/kick-js/pull/307) [`541ae2b`](https://github.com/forinda/kick-js/commit/541ae2bb2ce7325229d17d47c95432a97268c504) Thanks [@forinda](https://github.com/forinda)! - Make `zod` a truly optional peer dependency. `src/config/env.ts` previously did a top-level `import { z } from 'zod'` and built `baseEnvSchema` eagerly; since the env module is re-exported from the main entry, `import { anything } from '@forinda/kickjs'` pulled zod into the eager graph and crashed at build/load time for apps that validate env with Valibot/Yup/Standard Schema and never installed zod.

  zod is now lazy-loaded only when the Zod env helpers (`baseEnvSchema`, `defineEnv`, `loadEnv`) are actually used, with a clear error if it's missing. `baseEnvSchema` is now a lazy view that doesn't construct (or load zod) until accessed. The non-zod path (`loadEnvFromSchema`) needs no zod at all. `zod` is also marked `optional` in `peerDependenciesMeta`.

- [#307](https://github.com/forinda/kick-js/pull/307) [`541ae2b`](https://github.com/forinda/kick-js/commit/541ae2bb2ce7325229d17d47c95432a97268c504) Thanks [@forinda](https://github.com/forinda)! - Fix asset manager interfering with controller typegen, and make `assets.x.y()` resolve in dev for `kick.config.ts` projects.
  - **Typegen runner is now per-plugin isolated.** A throw in one typegen plugin (e.g. `kick/assets`) no longer aborts the whole pass — it's reported as an `error` and the remaining plugins (e.g. `kick/routes`) still run. Previously one failing plugin left the controller route types ungenerated.
  - **The stale-file sweep is now an allowlist, not a denylist.** It only removes the known pre-carve legacy filenames (`assets.d.ts`, `env.ts`, `routes.ts`) and never touches unknown/custom files. Previously, when the plugin pass returned nothing (e.g. it aborted), the sweep deleted live `kick__routes.ts` / `kick__assets.d.ts` — wiping controller types project-wide.
  - **Dev-mode asset resolution now works with `kick.config.ts`.** The runtime resolver reads config synchronously and can't transpile TS, so a `.ts`-config project had no manifest to resolve from until the first production build (`assets.x.y()` threw `UnknownAssetError`). The CLI now mirrors the JSON-serialisable `assetMap` + `build.outDir` into `.kickjs/kick.config.json` whenever it loads the config, and the runtime resolver reads that snapshot as a fallback.

## 5.14.2

### Patch Changes

- Updated dependencies [[`020c4d0`](https://github.com/forinda/kick-js/commit/020c4d05bc948907207b5e70d9ee9c2341bbb9c4), [`fd786f8`](https://github.com/forinda/kick-js/commit/fd786f8ef2bca43658b4263109d9f5f6977101a5)]:
  - @forinda/kickjs-schema@0.1.2

## 5.14.1

### Patch Changes

- Updated dependencies [[`edcdb33`](https://github.com/forinda/kick-js/commit/edcdb33bdcba2057dfa325fd8ca0474d73cdb50b)]:
  - @forinda/kickjs-schema@0.1.1

## 5.14.0

### Minor Changes

- [#295](https://github.com/forinda/kick-js/pull/295) [`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62) Thanks [@forinda](https://github.com/forinda)! - Add `defineContextDecorator.withParams<P>()(spec)` and `defineHttpContextDecorator.withParams<P>()(spec)` curried entry points.

  Fixes the partial-inference problem on parameterised contributors. The positional `defineContextDecorator<K, D, P, Ctx>(spec)` signature forces adopters to spell `K` and `D` the moment they want to specify the per-call params shape `P` — which drops automatic `deps` inference, so `(ctx, deps, params) => …` resolvers end up with `deps` typed as `Record<string, never>` (or worse, the wrong shape) unless the deps type is duplicated by hand.

  The curried form takes only `P`; `K` (from `spec.key` literal), `D` (from `spec.deps` value shape), and `Ctx` all infer from the spec:

  ```ts
  const LoadTenant = defineContextDecorator.withParams<{
    source: "header" | "subdomain";
  }>()({
    key: "tenant",
    deps: { repo: TENANT_REPO }, // D inferred
    paramDefaults: { source: "header" },
    resolve: (ctx, { repo }, params) => repo.findFor(ctx, params),
  });
  ```

  The positional form keeps working unchanged for back-compat.

- [#291](https://github.com/forinda/kick-js/pull/291) [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50) Thanks [@forinda](https://github.com/forinda)! - Schema-agnostic validation abstraction

  **New package: `@forinda/kickjs-schema`**

  - `KickSchema` interface — unified `safeParse()`, `toJsonSchema()`, `_raw`
  - `SchemaIssue` — normalized error format (path, message, code, expected, received)
  - `detectSchema()` — auto-detects KickSchema, Zod, Valibot, Yup, Standard Schema v1, functions, and duck-typed schemas
  - `registerAdapter()` — plug in custom schema libraries at runtime
  - `InferSchemaOutput<T>` — type-level inference for Zod, Valibot, Standard Schema, and KickSchema

  **Adapters (tree-shakable sub-exports):**

  - `@forinda/kickjs-schema/zod` — `fromZod()` with full issue normalization and JSON Schema via `.toJSONSchema()`
  - `@forinda/kickjs-schema/valibot` — `fromValibot()` with issue mapping and JSON Schema via `@valibot/to-json-schema`
  - `@forinda/kickjs-schema/yup` — `fromYup()` with `validateSync` error mapping and JSON Schema from `describe()` metadata

  **Framework integration:**

  - `validate()` middleware uses `detectSchema()` — accepts any supported schema library
  - Swagger `SchemaParser` uses `detectSchema().toJsonSchema()` instead of Zod-specific conversion
  - MCP adapter uses `detectSchema()` for tool input/output schema conversion
  - `loadEnvFromSchema()` — schema-agnostic env loader alongside existing Zod-only `loadEnv()`

  **Typegen:**

  - New `schemaValidator: 'kickjs-schema'` option emits `InferSchemaOutput<>` for route body/query/params and env types
  - Default `'zod'` unchanged — fully backward compatible
  - CLI: `kick typegen --schema-validator kickjs-schema`

- [#297](https://github.com/forinda/kick-js/pull/297) [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb) Thanks [@forinda](https://github.com/forinda)! - Fix schema-driven env typing end-to-end across `@forinda/kickjs-schema`, `loadEnvFromSchema`, and `kick typegen`.

  **`@forinda/kickjs-schema`**

  - `fromZod` / `fromValibot` / `fromYup` now infer their output type from the wrapped schema via `InferSchemaOutput<TSchema>`. Previously the `<TOutput = unknown>` generic defaulted to `unknown` whenever the caller didn't spell the output type explicitly — every wrapped schema landed at `KickSchema<unknown>` and propagated `unknown` into `KickEnv`. The explicit `<TOutput>` overload was dropped because TypeScript overload resolution always picked it with `TOutput = unknown` before reaching the inferring overload; adopters who want to spell the output type explicitly can cast (`fromZod(s) as KickSchema<MyShape>`) instead.
  - `InferSchemaOutput<T>` now resolves the Standard Schema brand (`~standard.types.output`) before Zod's `_output` (Zod v4 sometimes types `_output` as `never` on object schemas, which would mask the real shape), and adds a final branch for Yup's `__outputType`.

  **`@forinda/kickjs`**

  - `loadEnvFromSchema` now takes `<TSchema>(schema: TSchema): InferSchemaOutput<TSchema>` so the call site lands at the real env shape instead of `Record<string, unknown>`. A second overload preserves the `Record<string, unknown>` fallback for adopters who pass a runtime-only validator with no static brand.

  **`@forinda/kickjs-cli`**

  - `kick typegen` env-file detection regex broadened to match `fromZod(...)` / `fromValibot(...)` / `fromYup(...)` / `loadEnvFromSchema(...)` in addition to the legacy `defineEnv(...)`. Projects migrating off `defineEnv` to the schema-agnostic loader no longer get a silent `kick/env: skipped`.
  - Env renderer flattens the kickjs-schema inference via a mapped-type identity (`type _Resolved = { [K in keyof _Raw]: _Raw[K] }`) so `interface KickEnv extends _Resolved {}` lands at an object type TS accepts. Without it, `InferSchemaOutput<typeof envSchema>` stays as a conditional type and the interface extension errors with TS2312 ("interface can only extend an object type with statically known members") even when the conditional resolves to a plain object.

### Patch Changes

- Updated dependencies [[`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs-schema@0.1.0

## 5.14.0-alpha.0

### Minor Changes

- [#295](https://github.com/forinda/kick-js/pull/295) [`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62) Thanks [@forinda](https://github.com/forinda)! - Add `defineContextDecorator.withParams<P>()(spec)` and `defineHttpContextDecorator.withParams<P>()(spec)` curried entry points.

  Fixes the partial-inference problem on parameterised contributors. The positional `defineContextDecorator<K, D, P, Ctx>(spec)` signature forces adopters to spell `K` and `D` the moment they want to specify the per-call params shape `P` — which drops automatic `deps` inference, so `(ctx, deps, params) => …` resolvers end up with `deps` typed as `Record<string, never>` (or worse, the wrong shape) unless the deps type is duplicated by hand.

  The curried form takes only `P`; `K` (from `spec.key` literal), `D` (from `spec.deps` value shape), and `Ctx` all infer from the spec:

  ```ts
  const LoadTenant = defineContextDecorator.withParams<{
    source: "header" | "subdomain";
  }>()({
    key: "tenant",
    deps: { repo: TENANT_REPO }, // D inferred
    paramDefaults: { source: "header" },
    resolve: (ctx, { repo }, params) => repo.findFor(ctx, params),
  });
  ```

  The positional form keeps working unchanged for back-compat.

- [#291](https://github.com/forinda/kick-js/pull/291) [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50) Thanks [@forinda](https://github.com/forinda)! - Schema-agnostic validation abstraction

  **New package: `@forinda/kickjs-schema`**

  - `KickSchema` interface — unified `safeParse()`, `toJsonSchema()`, `_raw`
  - `SchemaIssue` — normalized error format (path, message, code, expected, received)
  - `detectSchema()` — auto-detects KickSchema, Zod, Valibot, Yup, Standard Schema v1, functions, and duck-typed schemas
  - `registerAdapter()` — plug in custom schema libraries at runtime
  - `InferSchemaOutput<T>` — type-level inference for Zod, Valibot, Standard Schema, and KickSchema

  **Adapters (tree-shakable sub-exports):**

  - `@forinda/kickjs-schema/zod` — `fromZod()` with full issue normalization and JSON Schema via `.toJSONSchema()`
  - `@forinda/kickjs-schema/valibot` — `fromValibot()` with issue mapping and JSON Schema via `@valibot/to-json-schema`
  - `@forinda/kickjs-schema/yup` — `fromYup()` with `validateSync` error mapping and JSON Schema from `describe()` metadata

  **Framework integration:**

  - `validate()` middleware uses `detectSchema()` — accepts any supported schema library
  - Swagger `SchemaParser` uses `detectSchema().toJsonSchema()` instead of Zod-specific conversion
  - MCP adapter uses `detectSchema()` for tool input/output schema conversion
  - `loadEnvFromSchema()` — schema-agnostic env loader alongside existing Zod-only `loadEnv()`

  **Typegen:**

  - New `schemaValidator: 'kickjs-schema'` option emits `InferSchemaOutput<>` for route body/query/params and env types
  - Default `'zod'` unchanged — fully backward compatible
  - CLI: `kick typegen --schema-validator kickjs-schema`

- [#297](https://github.com/forinda/kick-js/pull/297) [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb) Thanks [@forinda](https://github.com/forinda)! - Fix schema-driven env typing end-to-end across `@forinda/kickjs-schema`, `loadEnvFromSchema`, and `kick typegen`.

  **`@forinda/kickjs-schema`**

  - `fromZod` / `fromValibot` / `fromYup` now infer their output type from the wrapped schema via `InferSchemaOutput<TSchema>`. Previously the `<TOutput = unknown>` generic defaulted to `unknown` whenever the caller didn't spell the output type explicitly — every wrapped schema landed at `KickSchema<unknown>` and propagated `unknown` into `KickEnv`. The explicit `<TOutput>` overload was dropped because TypeScript overload resolution always picked it with `TOutput = unknown` before reaching the inferring overload; adopters who want to spell the output type explicitly can cast (`fromZod(s) as KickSchema<MyShape>`) instead.
  - `InferSchemaOutput<T>` now resolves the Standard Schema brand (`~standard.types.output`) before Zod's `_output` (Zod v4 sometimes types `_output` as `never` on object schemas, which would mask the real shape), and adds a final branch for Yup's `__outputType`.

  **`@forinda/kickjs`**

  - `loadEnvFromSchema` now takes `<TSchema>(schema: TSchema): InferSchemaOutput<TSchema>` so the call site lands at the real env shape instead of `Record<string, unknown>`. A second overload preserves the `Record<string, unknown>` fallback for adopters who pass a runtime-only validator with no static brand.

  **`@forinda/kickjs-cli`**

  - `kick typegen` env-file detection regex broadened to match `fromZod(...)` / `fromValibot(...)` / `fromYup(...)` / `loadEnvFromSchema(...)` in addition to the legacy `defineEnv(...)`. Projects migrating off `defineEnv` to the schema-agnostic loader no longer get a silent `kick/env: skipped`.
  - Env renderer flattens the kickjs-schema inference via a mapped-type identity (`type _Resolved = { [K in keyof _Raw]: _Raw[K] }`) so `interface KickEnv extends _Resolved {}` lands at an object type TS accepts. Without it, `InferSchemaOutput<typeof envSchema>` stays as a conditional type and the interface extension errors with TS2312 ("interface can only extend an object type with statically known members") even when the conditional resolves to a plain object.

### Patch Changes

- Updated dependencies [[`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs-schema@0.1.0-alpha.0

## 5.13.1

### Patch Changes

- [#285](https://github.com/forinda/kick-js/pull/285) [`53c3938`](https://github.com/forinda/kick-js/commit/53c39381ab6b30b95a67af9900969f4bad2506cc) Thanks [@forinda](https://github.com/forinda)! - Fix constructor injection for tsx/ts-node, make Logger injectable, add colored log levels.
  - **Constructor injection fallback:** `createInstance` now derives constructor arity from `@Inject` metadata when `design:paramtypes` is absent (tsx, ts-node don't emit it). `@Inject(Token)` on constructor params works without `emitDecoratorMetadata`.
  - **Logger is now injectable:** `@Inject(Logger)` resolves to a default Logger singleton auto-registered during bootstrap. Previously Logger had no DI binding and `@Inject(Logger)` threw `No provider for Logger`.
  - **Colored log levels:** `ConsoleLoggerProvider` prefixes each line with a colored level tag (`INFO`, `WARN`, `ERROR`, `DEBUG`, `FATAL`). Colors auto-disable when `NO_COLOR` env is set or stdout is not a TTY.

## 5.13.0

### Minor Changes

- [#277](https://github.com/forinda/kick-js/pull/277) [`ace5e84`](https://github.com/forinda/kick-js/commit/ace5e8499b74a7b333fa6c6024f53ab5f5fd6ea8) Thanks [@forinda](https://github.com/forinda)! - feat(errors): structured KickError with code, cause, and fix hint

  Framework-thrown errors are now `KickError` instances — a multi-line, scannable shape with a stable code, a cause explanation, an actionable fix, and a docs URL.

  ```text
  KICK001: No provider for UserService

    Cause:
      UserService was requested from the DI container but no binding
      is registered. This usually means one of:
        • The class is decorated with @Service() / @Repository() / @Controller(),
          but its enclosing module isn't passed to bootstrap({ modules: [...] }).
        • The class isn't decorated at all (decorators register the binding).
        • You're injecting a token (created with createToken()) that nothing
          provides — add a Container.register(TOKEN, ...) call or a module that
          binds it.

    Fix:
      If UserService lives in a module, add the module to bootstrap:

        bootstrap({
          modules: [
            UsersModule,        // add this
            OtherModule,
          ],
        })

    Docs:
      https://kickjs.app/guide/dependency-injection#registering-services
  ```

  **First catalog pass — 5 errors upgraded:**

  | Code      | When it fires                                                                |
  | --------- | ---------------------------------------------------------------------------- |
  | `KICK001` | DI: no provider registered for the requested token                           |
  | `KICK002` | DI: REQUEST-scoped binding resolved without request-scope middleware mounted |
  | `KICK003` | DI: REQUEST-scoped binding resolved outside an HTTP request                  |
  | `KICK004` | Config: `@Value('X')` resolved but env var not set and no default given      |
  | `KICK005` | Module: `routes()` declared a path without `controller` or `router`          |

  More framework errors will migrate to `KickError` over time. Codes are stable and never reused.

  **API:**

  - `KickError` class — extends `Error`. Holds `code`, `summary`, `cause`, `fix`, `docsUrl`, `context`. `.message` carries the full multi-line plain-text body so Node's default `Error.toString()` surfaces the helpful version automatically.
  - `formatKickError(err, { color })` — ANSI-colored renderer for terminal output. Honors `NO_COLOR` / `FORCE_COLOR` env vars when the `color` option is omitted.
  - All five catalog entries exposed via factory functions (`noProviderError`, `envValueMissingError`, etc.) for use by adopters' own integrations.

  **Backward compat:** errors still `instanceof Error`. Adopter code that catches generic `Error` keeps working. The previous error `message` substrings are replaced — adopters matching on those (e.g. `err.message.includes('No binding found')`) need to update to match the new wording, OR — better — switch to matching on `err.code` which is stable.

  **Tests:** 17 new in `kick-error.test.ts` (class, formatter, ANSI gating, every catalog entry, code uniqueness). Full kickjs suite **509/509 pass**.

  Closes B.2 (first pass) from the roadmap.

- [#275](https://github.com/forinda/kick-js/pull/275) [`7101444`](https://github.com/forinda/kick-js/commit/7101444c77d2eb3352f45db437401ff0ded0e1a6) Thanks [@forinda](https://github.com/forinda)! - feat(http): RFC 9457 — Problem Details for HTTP APIs

  KickJS now ships first-class support for [RFC 9457](https://datatracker.ietf.org/doc/html/rfc9457) — the canonical shape for HTTP API error responses. Two entry points:

  **`ctx.problem.*`** — response helpers on `RequestContext`:

  ```ts
  ctx.problem({
    type: "https://api.example.com/problems/out-of-credit",
    status: 403,
    detail: "Your balance is 30, but that costs 50.",
    balance: 30, // extension per §3.2
  });

  ctx.problem.notFound({ detail: "User abc not found" });
  ctx.problem.validation(zodResult.error.issues);
  ```

  Each call sets `Content-Type: application/problem+json` and fills in defaults (`type` → `about:blank` per §3.1.1, `title` → IANA reason phrase per §3.1.4). Shortcuts: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `tooManyRequests`, `internal`, plus the generic `ctx.problem({ status, ... })`.

  **`ProblemException`** — throw-from-anywhere class:

  ```ts
  throw ProblemException.forbidden({
    type: "https://api.example.com/problems/out-of-credit",
    detail: "Your balance is 30, but that costs 50.",
    balance: 30,
  });
  ```

  Extends `HttpException` so existing catches keep working. The framework error handler dispatches `ProblemException` first and emits `application/problem+json`. Plain `HttpException` keeps its existing `{ message }` JSON shape — backward compatible by detection (data-driven), not by config.

  **Deprecated** (`@deprecated` JSDoc, no runtime change):

  - `ctx.notFound()` → use `ctx.problem.notFound()`
  - `ctx.badRequest()` → use `ctx.problem.badRequest()`

  `ctx.json`, `ctx.created`, `ctx.noContent`, `ctx.html`, `ctx.download`, `ctx.render` are **not** deprecated — they're generic response helpers, orthogonal to the error-format question RFC 9457 answers.

  **New exports** from `@forinda/kickjs`:

  - `ProblemException` class
  - `ProblemDetails` type
  - `normalizeProblem(input)` helper (fills defaults — used internally, exposed for adopters writing their own response paths)
  - `defaultProblemTitle(status)` helper (IANA reason phrase lookup)

  **No bootstrap or kick.config.ts knob.** Adopters opt in per call site by reaching for the new helpers — no global flag, no migration deadline.

  Docs: `docs/guide/error-handling.md` covers the new section with Zod-integration recipes and a comparison of the two entry points.

### Patch Changes

- [#283](https://github.com/forinda/kick-js/pull/283) [`a46927e`](https://github.com/forinda/kick-js/commit/a46927e9102ea67d25df633df2a55d782ab23a3c) Thanks [@forinda](https://github.com/forinda)! - Fix 3 bugs blocking MCP HTTP transport and auth forwarding:

  1. **Route mount order** — `notFoundHandler` was registered before adapter `beforeStart` hooks, causing `/_mcp/messages` to 404. Swapped ordering so adapters mount routes before the catch-all.
  2. **Auth header dropped** — `buildMcpServer` didn't forward the SDK's `extra` parameter (carrying `requestInfo.headers`) to `dispatchTool`, so `Authorization` headers never reached the internal Express dispatch.
  3. **SDK callback signature mismatch** — `@modelcontextprotocol/sdk` uses `(args, extra)` when `inputSchema` is present but `(extra)` when absent. Tools backed by GET/DELETE routes silently lost auth headers.

  Context decorators (`@LoadUser`, `@LoadTenant`, etc.) now flow auth through MCP-dispatched calls identically to direct HTTP.

## 5.12.1

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

## 5.12.0

### Minor Changes

- [#266](https://github.com/forinda/kick-js/pull/266) [`462681b`](https://github.com/forinda/kick-js/commit/462681bd4254f93046f59fe187518f2b86b0e94a) Thanks [@forinda](https://github.com/forinda)! - deps: make `multer` an optional peer dependency; remove unused `cookie-parser`

  **multer** moves from `dependencies` to `peerDependencies` (range `^2.0.0`) with `peerDependenciesMeta.optional: true`. The package is now lazy-loaded via `createRequire(import.meta.url)` inside `upload.ts`, so importing `@forinda/kickjs` no longer touches `multer`. Adopters who never call `upload.single/array/none()` or use `@FileUpload` don't need it installed at all. If you do call those APIs without `multer` installed, you get a clear runtime error: `"@forinda/kickjs: file uploads require the 'multer' package, which is not installed. Install it: pnpm add multer"`.

  **cookie-parser** is removed entirely. It was never imported anywhere in the source — only mentioned in a `csrf.ts` JSDoc snippet as an example of middleware adopters should wire themselves. The `@types/cookie-parser` devDep is removed too.

  No breaking change for adopters who already have `multer` installed (pnpm/npm 7+ auto-install peers; pnpm strict mode surfaces a clear warning).

## 5.11.0

### Minor Changes

- [#265](https://github.com/forinda/kick-js/pull/265) [`187eb0b`](https://github.com/forinda/kick-js/commit/187eb0b2ce93b56dcccdc68febab95ed600c0ae4) Thanks [@forinda](https://github.com/forinda)! - refactor(logger): drop pino dependency, default to `ConsoleLoggerProvider`

  `@forinda/kickjs` no longer ships pino or pino-pretty. The default logger is now `ConsoleLoggerProvider`, which routes through `console.*` and has zero runtime dependencies. The pluggable `LoggerProvider` interface is unchanged — adopters who want pino, winston, bunyan, or anything else implement the same five-method contract and call `Logger.setProvider()` before `bootstrap()`. See `docs/guide/logging.md` for Pino, Winston, and silent-logger recipes.

  **Behavioural change for adopters relying on the default**: log lines lose pino's JSON envelope and `pino-pretty` colors. The new format is `[ComponentName] message`. If you depend on pino's output shape (structured fields, transports, log-aggregator-friendly JSON), copy the ~15-line PinoProvider snippet from `docs/guide/logging.md` and call `Logger.setProvider(new PinoProvider())` at startup.

  **Removed exports**: the `rootLogger` re-export from `@forinda/kickjs` and the `PinoLoggerProvider` class. The `LoggerProvider` interface, `ConsoleLoggerProvider`, `Logger`, and `createLogger` are unchanged.

  **CLI scaffolds**: `kick new` no longer pre-installs `pino` / `pino-pretty`, and the generated `vite.config.ts` no longer needs `ssr.external: ['pino', 'pino-pretty']`. Existing projects keep working without changes.

## 5.10.0

### Minor Changes

- [#262](https://github.com/forinda/kick-js/pull/262) [`fbe82c5`](https://github.com/forinda/kick-js/commit/fbe82c53082ae0c507b8e8ec85cd1fdbecb0e660) Thanks [@forinda](https://github.com/forinda)! - deps: move `zod` to `peerDependencies` in `@forinda/kickjs`; align `@forinda/kickjs-swagger` peer range

  **Why:** Pinning `zod` as a regular `dependency` of `@forinda/kickjs` meant adopters got whichever zod version kickjs happened to ship with — and couldn't upgrade to a newer zod release until kickjs cut a new version. Multiple zod copies in `node_modules` were also possible, with the well-known "schema built with copy A doesn't pass through `parse()` dispatched from copy B" failure mode on minor mismatches.

  Both packages now declare `zod: ^4.0.0` as a **peer dependency**, so the adopter picks the version. Within zod 4.x they can freely upgrade; for a future zod 5 they wait for kickjs to declare support (zod has historically had breaking majors).

  **`@forinda/kickjs`** — `zod` moved from `dependencies` to `peerDependencies` (required, not optional — `baseEnvSchema = z.object(...)` runs at module load when `@forinda/kickjs` is imported, so the framework can't load without zod present).

  **`@forinda/kickjs-swagger`** — peer range tightened from `>=4.0.0` to `^4.0.0` for consistency with kickjs. Stays optional: `schema-parser.ts` duck-types Zod schemas (no `import 'zod'` in `src/`) so adopters using non-Zod parsers (Joi, Valibot, Yup, ArkType) don't need zod at all.

  **Upgrade impact:**

  - Projects scaffolded with `kick new` already pin `zod: ^4.4.3` — no action required.
  - Projects on `npm install`, `yarn` (non-strict), or `pnpm install` without `--strict-peer-dependencies` will see a "missing peer dependency" warning if they don't have zod. Fix: `pnpm add zod` (or your package manager's equivalent).
  - Projects using pnpm with `strict-peer-dependencies=true` or npm 7+ with `--legacy-peer-deps=false` will hard-fail until they add zod themselves.

  No runtime API change. `import { z, baseEnvSchema, defineEnv, loadEnv, ... } from '@forinda/kickjs'` continues to work identically once zod is installed.

### Patch Changes

- [#263](https://github.com/forinda/kick-js/pull/263) [`e53f833`](https://github.com/forinda/kick-js/commit/e53f83358304fddfd10840a9f5a1ab603f184a2f) Thanks [@forinda](https://github.com/forinda)! - fix(assets): always return posix paths from `resolveAsset` / `assets.x.y()` / `useAssets()`

  `resolveAsset` now normalises returned paths to forward slashes on every platform. On Windows, it previously emitted native paths (`C:\Users\foo\dist\mails\welcome.ejs`), which broke:

  - splicing the result into URLs (`href` / `src` / CDN keys) — backslashes are invalid in URLs and silently corrupt the link
  - cross-host equality comparisons (a path produced on Windows vs. one on Linux)
  - substring assertions in adopters' tests

  Node's `fs.*` and Express's path-handling APIs accept either separator on Windows, so this change is safe for the common consumers — `express.static`, `res.sendFile`, `ejs.renderFile`, etc. The only adopter code it could break is something explicitly parsing Windows backslashes back out of the result, which would already be brittle.

  The internal manifest stays unchanged on disk; normalisation happens at the public-API boundary in `resolveAsset` only. The same value is then surfaced through `assets.x.y()`, `useAssets()`, and the `@Asset()` decorator.

## 5.9.2

### Patch Changes

- [#260](https://github.com/forinda/kick-js/pull/260) [`33e151b`](https://github.com/forinda/kick-js/commit/33e151b5cc9847254e91193edc05961aa0f7c931) Thanks [@forinda](https://github.com/forinda)! - fix(http): drop `DeepReadonly<>` from RequestContext getters; runtime warns via dev-only Proxy instead

  `RequestContext.{body,params,query,headers,file,files}` used to return `DeepReadonly<T>` (and `Readonly<>` for `headers`). The recursive conditional type interfered with TS narrowing — discriminated unions on `ctx.body`, drilldown into nested Zod-inferred shapes, and IDE jump-to-type all degraded — and slowed type-checking on deeply-nested payloads.

  The compile-time wrapper is gone. Runtime read-only enforcement now lives in a private `makeReadOnlyProxy()` helper:

  - **Dev (`NODE_ENV !== 'production'`)** — `ctx.body` returns a `Proxy` over `req.body` whose `set` / `deleteProperty` traps `console.warn` and leave the underlying object untouched. Strict-mode-safe (traps return `true`), so `ctx.body.foo = 'x'` doesn't throw mid-handler — it just warns + ignores the write.
  - **Production** — the Proxy is bypassed entirely; getters return `req.body` / `req.params` / etc. as-is. Zero overhead on the hot path.
  - Wrappers are cached per-target on `req` via a Symbol, so repeat access of `ctx.body` returns the same Proxy instance (stable under `===` across middleware / contributor / handler boundaries — relied on by router-builder's multi-RequestContext-per-request layout).

  The `DeepReadonly<T>` utility type stays exported (still useful for adopters who want to seal their own shapes). It just isn't applied to the framework's request getters anymore.

  Runtime read behavior is unchanged for callers — `ctx.body.email` still reads the email — but the TypeScript contract changed: assignment is no longer a compile-time error and now warns at dev time at runtime. Adopters who relied on the compile-time block should keep doing what they were doing (the contract is documented in JSDoc + warned at runtime). The Proxy is deep: nested mutations like `ctx.body.user.name = 'x'`, `ctx.files[0].fieldname = 'y'`, and `ctx.body.tags.push(...)` all surface the same warning, matching the prior `DeepReadonly<T>` depth at runtime instead of at the type level.

## 5.9.1

### Patch Changes

- [#254](https://github.com/forinda/kick-js/pull/254) [`d4bc212`](https://github.com/forinda/kick-js/commit/d4bc21292dedbb20ee1a952a43422a09afaf35fb) Thanks [@forinda](https://github.com/forinda)! - docs: README sweep — drop v4 references, switch examples to defineModule + factory shape, fix dead links

  Documentation-only patch bump so the updated READMEs ship to the npm-displayed package pages (npm always includes README.md in the tarball regardless of `files` field). No code or wire-format changes; safe to consume without changes.

  **`@forinda/kickjs`** — full rewrite of the README's getting-started. Was 60 lines using a `class implements AppModule` example with a deprecated `buildRoutes` import. Now walks through service → controller → module → registry → bootstrap in canonical v5 factory shape, with Zod validation, typed `Ctx<KickRoutes…>`, project-layout overview, and pointers to every relevant guide page.

  **`@forinda/kickjs-cli`** — add `bun` to the `--pm` flag list (the CLI's `kick new` prompt supports bun; the README was missing it).

  **`@forinda/kickjs-vite`** — fix dead doc link (`guide/vite-plugin` → `guide/hmr`; no `vite-plugin.md` exists, the HMR guide covers the plugin surface).

  **`@forinda/kickjs-auth`** — replace `kick add auth` install with `pnpm add @forinda/kickjs-auth`. The package was removed from the `kick add` registry; existing adopters who still depend on it install manually now, and the README points at the BYO Auth recipe for the canonical path forward.

  **`@forinda/kickjs-queue`** — list provider variants in the install section (`kick add queue:bullmq | rabbitmq | kafka | redis-pubsub`). README previously only mentioned BullMQ even though three other providers ship in the package.

  **`@forinda/kickjs-lint`** — scrub the stale v3 → v4 migration link suffix; point at the current DI Tokens guide instead.

  **`kickjs-devtools` (VS Code extension)** — disambiguate the naming collision with `@forinda/kickjs-devtools` (the runtime adapter that serves `/_debug/*`). Adds an explicit "VS Code editor extension, not the runtime adapter" callout, and recommends setting `secret: env.DEVTOOLS_SECRET` on the adapter for production gating.

  Root repo `README.md` is also rewritten (drop v4.2 banner, remove "Deprecated — going private in v5" table for packages already gone, switch Hello World to factory patterns, drop `kick g resolver` and `kick add auth` references, update `kick g agents` description to `.agents/` subfolder layout) — but that file isn't published, so it's a free-rider on this changeset.

## 5.9.0

### Minor Changes

- [#252](https://github.com/forinda/kick-js/pull/252) [`9f1e90e`](https://github.com/forinda/kick-js/commit/9f1e90e00160dfb3801e8bac451ace0aa7b3f37f) Thanks [@forinda](https://github.com/forinda)! - feat(devtools): render full introspect snapshot + surface module-level contributors with intact dependsOn

  Three related fixes addressing two adopter reports: the DevTools dashboard wasn't surfacing data that `introspect()` and context-contributor `dependsOn` were already providing.

  **1. PrimitiveRow renders all `IntrospectionSnapshot` fields**

  The server side has been collecting `introspect()` snapshots correctly for every adapter / plugin in `/_debug/topology`. The SPA's `PrimitiveRow` in `TopologyTab.tsx` only rendered `name`, `version`, `tokens.provides`, and `metrics` — silently dropping `state`, `tokens.requires`, `memoryBytes`, and `kind`. Adopters whose `introspect()` returned (say) `{ state, memoryBytes, tokens: { requires } }` saw a row with just the name.

  PrimitiveRow now renders all six fields, with `memoryBytes` formatted as B/KB/MB/GB and `state` rendered as key/value pairs (JSON-stringified for nested objects).

  **2. Module-level contributors surface via `Application.getContributors()`**

  The framework's `getContributors()` deliberately skipped module-level registrations because module instances aren't retained on the `Application` instance post-bootstrap. Adopters who declared `AppModule.contributors?()` returning a typed `dependsOn` saw the contributor missing entirely from the DevTools Contributors table, which read as "empty deps."

  `Application.setup()` now retains a snapshot of every module-level registration (just the frozen `{ key, dependsOn }` view — no `resolve` closures kept), and `getContributors()` returns those entries with `source: 'module'`. The snapshot is cleared at the start of each `setup()` pass so test harnesses and dev-server restarts don't accumulate stale entries.

  Per-route (method/class decorator) contributors still aren't enumerated — they live on the route registry and warrant a separate RPC; flagged as a follow-up.

  **3. `TopologyContributorEntry.source` widens to the full union**

  The kit's `source` field was typed as bare `string` with a JSDoc-documented enum; the server collapsed `'plugin' | 'global'` → `'adapter'` because of an earlier narrower mapping. Both are now removed: kit ships a proper `TopologyContributorSource` union (`'method' | 'class' | 'module' | 'adapter' | 'plugin' | 'global'`), and the server passes `source` through unchanged. Dashboards can now badge / filter by the real origin. Wire-format change is backward-compatible (new enum value added to an existing string field).

  **4. `IntrospectionSnapshot` reachable from `@forinda/kickjs` directly**

  `AppAdapter.introspect?()` and `KickPlugin.introspect?()` were typed as `unknown` — the JSDoc told adopters to import `IntrospectionSnapshot` from `@forinda/kickjs-devtools-kit` to satisfy the contract, taking on a dep just for the type. The snapshot type now lives canonically in `@forinda/kickjs` (`core/introspect.ts`); the kit's existing `IntrospectionSnapshot` stays structurally identical for back-compat. Adopters who don't already use the kit can write `introspect()` with full inference, no extra import:

  ```ts
  export const MyAdapter = defineAdapter({
    name: "MyAdapter",
    build: () => ({
      introspect() {
        // Return-type fully inferred — no `import type` needed.
        return {
          protocolVersion: 1,
          name: "MyAdapter",
          kind: "adapter",
          state: { connectedAt: Date.now() },
          memoryBytes: 12_345,
          tokens: { provides: ["REDIS"], requires: [] },
          version: "1.0",
          metrics: { activeConnections: 3 },
        };
      },
    }),
  });
  ```

  **Tests**

  `application-get-contributors.test.ts` adds three cases: `dependsOn` survives `getContributors()` (regression guard); module-level contributors appear after `setup()` with `source: 'module'` and intact `dependsOn`; re-setup doesn't accumulate stale module entries.

- [#253](https://github.com/forinda/kick-js/pull/253) [`652a6bf`](https://github.com/forinda/kick-js/commit/652a6bf0dbac1c4c288fc921bb2782f28c1207a4) Thanks [@forinda](https://github.com/forinda)! - feat(reactivity): `ref()` and `computed()` auto-unwrap on `JSON.stringify`

  Both `ref()` and `computed()` now implement `toJSON()` returning their current `value`. This means refs serialize transparently inside larger JSON payloads — adopters who keep adapter / plugin state in refs and surface it via `introspect()` no longer need to `.value`-unwrap manually at every call site:

  ```ts
  // Before — manual unwrap:
  introspect() {
    return {
      state: {
        connectedAt: this.connectedAt.value, // .value everywhere
        activeConnections: this.activeConnections.value,
      },
    }
  }

  // After — refs serialize as their value:
  introspect() {
    return {
      state: {
        connectedAt: this.connectedAt,        // JSON.stringify unwraps
        activeConnections: this.activeConnections,
      },
    }
  }
  ```

  `computed()` recomputes when stale on `toJSON` access — same cost as reading `.value`.

  The `Ref<T>` and `ComputedRef<T>` interfaces gain a `toJSON(): T` method to match.

  **`reactive()` is unchanged** — JSON.stringify walks its enumerable keys via the existing Proxy get-trap, already producing the correct shape. Test pins that behavior as a regression guard.

  **One-shot semantics**: `JSON.stringify` calls `toJSON` exactly once per value chain. `ref(ref(x))` serializes to `{"value": x}` rather than `x` because the inner ref's `toJSON` is reached via property walking, not a fresh substitution. The test suite documents this so a future "recursive unwrap" refactor doesn't land silently.

  Backward-compatible — `toJSON` is additive, and existing code that read `.value` continues to work unchanged.

## 5.8.0

### Minor Changes

- [#246](https://github.com/forinda/kick-js/pull/246) [`a94780c`](https://github.com/forinda/kick-js/commit/a94780c26ceee6355c4680a5aeed36d83664a021) Thanks [@forinda](https://github.com/forinda)! - feat(http): widen AdapterMiddleware.path + tighten handler typing + clarify lifecycle docs

  Three improvements to the adapter middleware contract, surfacing from a real-world bug-report investigation that found no bug — just sharp edges:

  **1. Widened path scope.** `AdapterMiddleware.path` now accepts `string | RegExp | (string | RegExp)[]` (new `MiddlewarePath` type, exported from `@forinda/kickjs`) instead of a bare `string`. Mirrors Express's native `app.use(path, …)` shape so adopters get the full range without learning a new mini-language:

  ```ts
  middleware() {
    return [
      { handler: rateLimit(), phase: 'beforeRoutes', path: ['/api', '/admin'] },
      { handler: csrf(), phase: 'afterGlobal', path: /^\/api\/v\d+\//, },
      { handler: bodyLog({ region: 'eu' }), phase: 'afterGlobal', path: ['/api', /^\/internal\//] },
    ]
  }
  ```

  The framework copies readonly arrays before passing to Express (`PathParams` requires a mutable array), so adopters can declare paths with `as const` without any runtime workaround.

  **2. Tighter `handler` typing.** `AdapterMiddleware.handler` is now `RequestHandler | ErrorRequestHandler` instead of `any`. Adapters that ship error-handling middleware get type checking; the union resolves via Express's arity-based dispatch.

  **3. Lifecycle JSDoc clarified.** The `MiddlewarePhase` JSDoc spells out the `afterRoutes` semantics — fires **only on fall-through** (no route matched, or a handler called `next()` without ending the response). Controllers that respond with `ctx.json(…)` end the chain and skip this phase. For per-response work (logging, metrics) the doc points adopters at `res.on('finish', …)` from an earlier phase instead. The `kick g middleware` generator template now embeds the same guidance so freshly scaffolded middleware files explain phase trade-offs at the point of use.

  New tests in `__tests__/adapter-middleware-path-patterns.test.ts` exercise every path shape (string prefix, array of strings, single RegExp, mixed array, `as const` readonly array, omitted). The existing `lifecycle-mount-order.test.ts` continues to lock in the order semantics.

### Patch Changes

- [#241](https://github.com/forinda/kick-js/pull/241) [`e0bf64b`](https://github.com/forinda/kick-js/commit/e0bf64b28e032bd2fee88ed397740430c7d74ae8) Thanks [@forinda](https://github.com/forinda)! - fix(http): preserve module/adapter/global context contributors across auto-derived router builds

  When a module returns `{ path, controller }` (auto-derive shape) instead of `{ path, router: buildRoutes(...) }`, the framework calls `buildRoutes(controller)` after `mod.routes()` returns. The internal `_externalContributorSources` slot was being cleared in a `finally` immediately after `mod.routes()` — so by the time `buildRoutes` ran, module-level, adapter-level, and global contributors were dropped from the pipeline. Any class/method-level `dependsOn` against a module-level key surfaced at boot as `MissingContributorError: Missing context contributor '<key>' required by '<dependent>' on route ...`.

  The slot lifetime now spans both `mod.routes()` and the subsequent per-route `buildRoutes(controller)` calls, then clears in a single `finally`. Existing modules that pre-built routers inside `routes()` were unaffected (they ran while the slot was still set) — this fix closes the gap for the documented `{ path, controller }` shape and `defineModule({ build: () => ({ contributors, routes }) })` pattern.

- [#245](https://github.com/forinda/kick-js/pull/245) [`a583829`](https://github.com/forinda/kick-js/commit/a5838298632e419389e3464779b9cb2f049d4392) Thanks [@forinda](https://github.com/forinda)! - test(http): lock in Application middleware lifecycle mount order

  Adds a dedicated test file (`__tests__/lifecycle-mount-order.test.ts`) that exercises every documented step of `Application.setup()` and asserts the runtime mount order through the real Express stack. Six cases:

  - `beforeMount` → `register()` → `beforeStart` hooks fire during `setup()` in adapter / plugin declaration order
  - `afterStart` only fires under `start()`, never `setup()` (the documented contract for `createTestApp` compatibility)
  - Per-request middleware fires in phase order: `beforeGlobal` (adapter) → plugin → user-declared global → `afterGlobal` (adapter) → `beforeRoutes` (adapter) → route handler
  - `afterRoutes` middleware does fire when a request falls through to the 404 handler — guards against accidentally short-circuiting the chain
  - Multiple adapters within the same phase fire in `dependsOn`-topological order at runtime (cascading from the existing construction-time sort to per-phase execution)
  - Plugin middleware fires before user-declared global middleware (§3c precedes §4)

  No production behaviour change — pure regression coverage for previously untested lifecycle contracts.

## 5.7.1

### Patch Changes

- [#238](https://github.com/forinda/kick-js/pull/238) [`4286e9f`](https://github.com/forinda/kick-js/commit/4286e9f37d5645837fb4a5753ff2e2bb6f198298) Thanks [@forinda](https://github.com/forinda)! - fix(core): restore typed `KickJsRegistry` overload on `@Autowired`

  The first overload — `<K extends keyof KickJsRegistry & string>(token: K)` —
  already exists on `@Inject` but was lost on `@Autowired` during the
  dual-position unification in forinda/kick-js#236. Without it, adopters lose
  string-literal narrowing + typo detection when reaching for `@Autowired`
  instead of `@Inject`, even though the two are interchangeable everywhere
  else.

  After `kick typegen` populates the registry, `@Autowired('kick/prisma/Client')`
  now autocompletes the key and typo'd literals become TS2345 errors, matching
  `@Inject` exactly. No runtime behaviour change.

## 5.7.0

### Minor Changes

- [#236](https://github.com/forinda/kick-js/pull/236) [`a5e6a33`](https://github.com/forinda/kick-js/commit/a5e6a331af581d62022025e499ff496055a9f89a) Thanks [@forinda](https://github.com/forinda)! - fix: close the four DX rough edges from forinda/kick-js#235

  Bundles all four reported issues into one PR per the request. Each lands independently — the failing surface for one didn't depend on any other — but a stacked PR keeps the review and CHANGELOG entry coherent.

  ### §1 — `ContextDecoratorTarget` is now publicly exported

  Adopters wrapping `defineHttpContextDecorator(...)` in a public method-decorator factory hit `TS4058` under `declaration: true` builds because the inferred return type referenced an internal symbol. The interface was already exported from `core/context-decorator.ts`; it just wasn't re-exported from `core/index.ts`. One-line fix — adopters can now annotate their wrapper's return type as `ContextDecoratorTarget` instead of re-deriving the legacy `MethodDecorator` shape locally.

  ```ts
  import {
    defineHttpContextDecorator,
    type ContextDecoratorTarget,
  } from '@forinda/kickjs'

  const RequirePermissionContext = defineHttpContextDecorator<...>({...})

  export function RequirePermission(code: PermissionCode): ContextDecoratorTarget {
    return RequirePermissionContext({ permissionCode: code })
  }
  ```

  ### §2 — `@Autowired` and `@Inject` work in either position

  Both decorators now accept the property-decorator position AND the constructor-parameter-decorator position. Pick whichever name reads better at the call site:

  ```ts
  @Service()
  class UserRepo {
    // Property position — both names work.
    @Autowired(DB) private db1!: KickDbClient;
    @Inject(DB) private db2!: KickDbClient;

    // Constructor parameter position — both names work.
    constructor(
      @Autowired(LOGGER) private logger: Logger,
      @Inject(CACHE) private cache: Cache
    ) {}
  }
  ```

  Runtime detects the position via the standard "third arg is a number" check (TypeScript's legacy parameter decorator signature) and routes to the correct metadata bucket (`AUTOWIRED` for properties keyed by prototype + name, `INJECT` for params keyed by constructor + index). The pre-existing no-token reflection-based forms (`@Autowired() private foo!: SomeClass` and `@Inject(SomeClass) foo`) keep working unchanged — `design:type` / `design:paramtypes` fallback still fires when token is undefined.

  7 new unit cases in `packages/kickjs/__tests__/inject-autowired-positions.test.ts` lock the matrix.

  ### §3 — mount-prefix `:params` propagate into `ctx.params` types

  Controllers mounted under a path with parameters (e.g. `/control/orgs/:id/extensions`) no longer need `params: orgIdParamsSchema` repeated on every route to type `ctx.params.id`. The typegen scanner now extracts each module's `routes()` body for `{ path, controller }` pairs and combines the mount path with the per-route path before extracting `:params`. Per-route `params: schema` declarations still override (schema wins over the URL-pattern fallback, as before).

  Multi-mount controllers (rare, e.g. v1 + v2 versioned variants) take the first mount's prefix; the per-route `params: schema` escape hatch handles asymmetric cases.

  6 new unit cases in `packages/cli/__tests__/scanner-mount-path-params.test.ts`.

  ### §4 — typegen warns when a decorated file isn't picked up by any module glob

  The default module template generates `import.meta.glob([patterns])` to side-effect-register decorated classes. Adopters who add a new file type (e.g. `context-decorators/*.ts`) and forget to extend the glob got silent registration drift — the decorator never fires, downstream hits a confusing `MissingContributorError` at request time.

  The typegen scanner now extracts every module file's globs, matches each decorated class file in the module subtree against them, and emits a `console.warn` for orphans:

  ```text
    kick typegen: 1 decorated class(es) not matched by any module's import.meta.glob():
      @Service RequireExtensionEnabled (src/modules/ext/context-decorators/require-extension.ts)
        → not picked up by any glob in src/modules/ext/ext.module.ts
  ```

  Surfaced at every `kick typegen` (and `kick dev` pre-typecheck) run. Doesn't fail the build — adopters who deliberately exclude files keep working — but the orphan is impossible to miss.

  9 new unit cases across `packages/cli/__tests__/scanner-orphaned-classes.test.ts` lock the glob-to-regex translator (`**/` → `(?:.+/)?`, `*` → `[^/]*`, `?` → `.`, negation patterns subtract) and `fileMatchesAnyGlob` semantics.

  ### Numbers

  | Package               | Before    | After           |
  | --------------------- | --------- | --------------- |
  | `@forinda/kickjs`     | 408 tests | 415 tests (+7)  |
  | `@forinda/kickjs-cli` | 276 tests | 291 tests (+15) |

  Minor bumps — all changes additive. Both `@Autowired`/`@Inject` working in either position is a behaviour widening (previously rejected positions now accept) so technically minor; the rest are additive surface (`ContextDecoratorTarget` export, new typegen warning) or scanner internals.

## 5.6.0

### Minor Changes

- [#221](https://github.com/forinda/kick-js/pull/221) [`7bc0d23`](https://github.com/forinda/kick-js/commit/7bc0d23084e1fcb8df346856dfb16bb5bd2f2f13) Thanks [@forinda](https://github.com/forinda)! - feat(kickjs): `RequestContext.signal` — `AbortSignal` for request-scoped cancellation

  `RequestContext` now exposes a `signal: AbortSignal` getter that fires when the underlying HTTP request closes (client disconnect, response sent, or timeout). Thread it through anything that takes an `AbortSignal` so the work cancels as soon as the client gives up.

  ```ts
  import {
    Controller,
    Get,
    Autowired,
    type RequestContext,
  } from "@forinda/kickjs";
  import { TasksRepository } from "./tasks.repository";

  @Controller()
  export class TasksController {
    @Autowired() private readonly tasks!: TasksRepository;

    @Get("/:id/full")
    async showFull(ctx: RequestContext) {
      const row = await this.tasks.findFullById(
        ctx.params.id as string,
        ctx.signal
      );
      if (!row) return ctx.notFound();
      ctx.json(row);
    }
  }
  ```

  The repo passes `signal` to `db.query.<table>.findUnique({ signal })`; if the client disconnects mid-flight, kickjs-db's M5.A.2 plumbing maps the abort to `RelationalQueryCancelledError` and short-circuits the in-flight query instead of churning a connection until completion.

  **Why this exists** — M5.A.2 (`@forinda/kickjs-db@5.6.0`) shipped the `signal?: AbortSignal` option on `FindManyOptions` / `FindFirstOptions` / `FindUniqueOptions` with a docstring that pointed adopters at "`RequestContext.signal` from kickjs-http". `RequestContext.signal` didn't actually exist yet; this release closes that gap so the integration story is honoured end-to-end.

  **Implementation note** — the per-request `AbortController` is cached on the underlying `req` object via a Symbol key, so the multiple `RequestContext` wrappers that router-builder constructs (one per middleware, one per contributor pipeline, one for the main handler) all observe the same signal. The signal aborts on either `req.on('close')` or `res.on('close')` — whichever fires first; subsequent closes are no-ops.

  Tests: 6 new unit cases in `packages/kickjs/__tests__/context-signal.test.ts` — initial-state, request-close abort, response-close abort, identity stability, shared-controller across multiple `RequestContext` wrappers for the same `req`, idempotency on repeated abort.

  Demonstrated end-to-end in `examples/task-kickdb-api`: `TasksController.showFull` (`GET /tasks/:id/full`), `WorkspacesController.showFull` (`GET /workspaces/:id/full`), and `WorkspacesController.ownedBy` (`GET /workspaces/owned-by/:userId`) all thread `ctx.signal` into the corresponding `findFullById` / `listOwnedByUser` repo methods.

  Closes the M5 exit-gate item that referenced `ctx.signal` literally. Additive — no breaking change. M5 "no major bumps" rule respected.

## 5.5.0

### Minor Changes

- [#191](https://github.com/forinda/kick-js/pull/191) [`dc86690`](https://github.com/forinda/kick-js/commit/dc866902a7ed736f0c16e4d7fd2eb44c55816077) Thanks [@forinda](https://github.com/forinda)! - `defineModule()` factory + simplified `routes()` shape — the fourth `define*` primitive lands and the codegen + docs sweep follows.

  ## `defineModule()` — new factory

  Mirrors `defineAdapter` / `definePlugin` / `defineContextDecorator` so adopters learn one mental model across all four primitives. The legacy `class FooModule implements AppModule { ... }` form keeps working — `bootstrap` accepts either shape and the loader discriminates at boot.

  ```ts
  const TasksModule = defineModule({
    name: "TasksModule",
    defaults: { scope: "public" },
    build: (config, { name }) => ({
      register(container) {
        container.registerInstance(`tasks:scope:${name}`, config.scope);
      },
      routes() {
        return { path: `/${config.scope}/tasks`, controller: TasksController };
      },
      contributors() {
        return [LoadTenant.registration];
      },
    }),
  });

  bootstrap({
    modules: [
      TasksModule(), // public scope (defaults)
      TasksModule.scoped("admin", { scope: "admin" }), // namespaced clone
    ],
  });
  ```

  - `(config?)` call form returns the module instance.
  - `.scoped(scopeName, config?)` returns a namespaced instance (build-context name becomes `${moduleName}:${scope}`).
  - `.definition` exposes the frozen options snapshot for tooling.

  `.async()` is intentionally **not** part of the surface. Module config has no async-resolution window: `register()` and `routes()` both run synchronously during bootstrap, before any adapter `beforeStart` hook fires. Adopters who need async-resolved config push it into an adapter and inject the resolved value into the module via DI tokens.

  Boot-time validation: missing `name`, missing `build`, non-function `build`, non-object options all throw `TypeError` immediately (typically module-load) so adopters get a clear error before bootstrap.

  ## `AppModuleEntry` union type

  `bootstrap({ modules })`, `KickPlugin.modules?()`, and `createTestApp({ modules })` now accept `AppModuleEntry = AppModuleClass | AppModule` so `defineModule`-output instances and legacy classes mix freely in the same array. The Application loader discriminates `typeof entry === 'function'` to dispatch — classes get `new`-ed, instances are used directly.

  ## `defineModules()` — fluent module-list builder

  ```ts
  import { bootstrap, defineModules } from "@forinda/kickjs";

  const modules = defineModules()
    .mount(HelloModule())
    .mount(TasksModule())
    .mount(AdminModule());

  await bootstrap({ modules });
  ```

  `defineModules()` returns a `ModuleList` (an `AppModuleEntry[]` subclass with a chainable `.mount()`). Drops into `bootstrap({ modules })` directly — no unwrap step — because `ModuleList extends Array<AppModuleEntry>`. Optional vararg seeds the list inline: `defineModules(HelloModule()).mount(TasksModule())` composes the two forms naturally.

  The plain `[X(), Y()]` array form keeps working — `defineModules()` is the fluent alternative for adopters who prefer the call-then-call pattern that mirrors `definePlugin().scoped(...)` / `defineAdapter()` elsewhere in the framework. Both produce the same shape internally.

  ## `ModuleRoutes` simplified — `controller` alone is sufficient

  ```ts
  // Before
  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UserController),
      controller: UserController,
    }
  }

  // After
  routes() {
    return {
      path: '/users',
      controller: UserController,  // framework derives router via buildRoutes() internally
    }
  }
  ```

  The `router` field is now optional — when omitted, the framework calls `buildRoutes(controller)` itself. `controller` was already required for OpenAPI introspection via `SwaggerAdapter`, so the simplification removes the redundant `router: buildRoutes(...)` boilerplate without losing capability. Adopters who hand-build a router (composing multiple controllers, mounting third-party routers) keep passing `router` directly — both shapes are supported.

  Existing modules that still pass `router: buildRoutes(...)` keep working untouched. The new shape just removes the boilerplate going forward.

  ## CLI codegen sweep — `@forinda/kickjs-cli`

  Every module template (`generateModuleIndex` DDD, `generateRestModuleIndex`, `generateMinimalModuleIndex`, `cqrs.ts`'s `generateCqrsModuleIndex`, `scaffold.ts`'s `genModuleIndex`, `project-app.ts`'s `generateHelloModule`) now emits the `defineModule({ name, build })` form with the simplified `{ path, controller }` route shape.

  Each generated `routes()` carries a JSDoc hint demonstrating the array-return + per-entry `version` override so adopters discover that surface from the generated file, not from a separate doc:

  ```ts
  /**
   * Return an array to mount multiple route sets — each entry can
   * override the API version with a `version` field — the mount path
   * becomes `/{apiPrefix}/v{version}{path}`:
   *
   *   return [
   *     { path: '/tasks', version: 1, controller: TasksV1Controller },
   *     { path: '/tasks', version: 2, controller: TasksV2Controller },
   *   ]
   */
  ```

  The `kick g module` orchestrator updates `src/modules/index.ts` to insert the factory-call form (`TasksModule()`) — the type annotation switches from `AppModuleClass[]` to `AppModuleEntry[]`. The `kick rm module` regex updated to match both `Module` and `Module()` forms.

  The `definePlugin` generator's `modules()` return type updated to `AppModuleEntry[]` with a comment explaining that both class and factory forms work.

  The `kick g scaffold` command now refuses with an actionable message when the project pattern isn't `'ddd'` — the field-based scaffold templates only support the DDD layout today, so non-DDD projects need to use `kick g module` until the scaffold variants land.

  ## `@forinda/kickjs-testing`

  `CreateTestAppOptions.modules` switches to `AppModuleEntry[]` so test apps accept both shapes. The isolated-container path inside `createTestApp` discriminates class vs instance the same way Application does — classes get `new`-ed, factory output is used directly. `KickPlugin.modules()` typing in the test-plugin harness updated in lockstep.

  ## Docs sweep

  Active adopter-facing guides updated: `docs/guide/modules.md` (full rewrite leading with `defineModule`), `getting-started.md`, `project-structure.md` (canonical examples). `plugins.md`, `migration-from-express.md`, `testing.md`, `generators.md`, `tutorial-hmr-decorators.md`, `tutorial-generator-patterns.md` get the type-annotation rename so the `AppModuleEntry[]` story is consistent across the docs site. Versioned snapshots under `docs/versions/` left untouched (they're locked to their respective releases).

  ## What's deferred

  - `kick g scaffold` for REST / CQRS / minimal patterns — currently only emits DDD-shaped layouts. The command refuses on non-DDD projects with a clear error pointing at `kick g module` as the workaround.
  - Module-registry pattern for plugins (`.mount(module)` / `.use(module)` factory) — separate design conversation; the flat-array `modules?(): AppModuleEntry[]` is the stable shape for now.

- [#192](https://github.com/forinda/kick-js/pull/192) [`f5c91f5`](https://github.com/forinda/kick-js/commit/f5c91f53bb42af4ae42eb3fdec4b1d9f312ad1f0) Thanks [@forinda](https://github.com/forinda)! - `ModuleRegistry` + `setup(registry)` callback — imperative module registration alongside the static `modules: [...]` array. Lays the foundation for `.use(module)` (non-HTTP modules) without committing to its semantics yet.

  ## What's new

  ```ts
  import { bootstrap } from "@forinda/kickjs";

  await bootstrap({
    modules: [HelloModule()], // static — always mounted

    setup(registry) {
      if (process.env.ENABLE_ADMIN === "true") {
        registry.mount(AdminModule());
      }
      for (const tenant of TENANTS) {
        registry.mount(TenantModule.scoped(tenant.id, tenant));
      }
    },
  });
  ```

  - New `ModuleRegistry` type with one method: `.mount(module: AppModuleEntry)`. Internal collector `MutableModuleRegistry` is what bootstrap passes around; adopters interact through the interface.
  - New `ApplicationOptions.setup?(registry: ModuleRegistry)` callback on `bootstrap()`.
  - New `KickPlugin.setup?(registry: ModuleRegistry)` lifecycle hook on plugins. Runs after `plugin.modules?()` so plugins can mix static + dynamic registration in the same plugin.

  Order across the whole pipeline (preserved across bootstrap):

  1. plugin static modules (`plugin.modules?()`)
  2. plugin `setup()` calls (in plugin dependsOn-sorted order)
  3. user static modules (`options.modules`)
  4. user `setup()` callback

  The static `modules: [...]` array keeps working unchanged — `setup` is purely additive.

  ## Why only `.mount(module)` (not `.use`)

  `.mount` covers the HTTP-feature path that drives most adopter use today. A future `.use(module)` is planned for non-HTTP modules (queues, cron, workers, DI-only seeds) — adding it later won't be a breaking change because `ModuleRegistry` is the adopter-facing type and `mount()` is the only stable method on it now. Existing non-HTTP modules continue returning `null` from `routes()` and using `.mount()` (or staying in the static array) until `.use` lands.

  ## Soft deprecation

  `AppModuleClass` now carries a `@deprecated` JSDoc tag pointing at `defineModule({...})` + `AppModuleEntry`. The class form keeps working through v5 — no runtime warnings, no breaking changes — the annotation is a soft "prefer the factory form" hint shown in IDE tooltips.

  ## Tests

  - `MutableModuleRegistry`: starts-empty, mount-appends-in-order, accepts both class and instance forms, referentially-stable entries array, surface only exposes `mount`.
  - Application integration: bootstrap setup callback runs and threads mounts through the loader; plugin.setup runs before bootstrap.setup; missing setup is backwards compatible; plugin setup threads captured config.

  Suite: 375 → 385 tests (+10). Build + typecheck clean.

  ## Docs

  `docs/guide/modules.md` gains a "Conditional registration — `setup(registry)`" section. `docs/guide/plugins.md` adds `setup()` to the lifecycle table with a `modules() vs setup()` subsection covering when to use each.

### Patch Changes

- [#190](https://github.com/forinda/kick-js/pull/190) [`a812ad5`](https://github.com/forinda/kick-js/commit/a812ad5daa9c3acbe9583eec632a766dadafaea8) Thanks [@forinda](https://github.com/forinda)! - Harden `defineContextDecorator` based on review feedback. Six tightening passes, all backwards-compatible:

  1. **Boot-time spec validation.** `defineContextDecorator` now throws `TypeError` immediately if `spec` is missing/non-object, `spec.key` is empty, `spec.resolve` isn't a function, `spec.onError` is provided but not a function, or `spec.dependsOn` is provided but not an array. Adopters get definition-time errors (typically module load) instead of cryptic ContextMeta misses at first request.
  2. **Source-location capture.** Every registration now carries `definedAt: string` — a snapshot of `new Error().stack` taken at decorator-construction time. The contributor pipeline threads it into `MissingContributorError`'s message so boot-time errors print `declared at src/contributors/load-project.ts:42:18` instead of forcing adopters to grep for the key string.
  3. **Cleaner type story.** Replaced the trailing `as unknown as ContextDecorator<...>` double-cast with overloaded function signatures + `Object.assign` + `Object.freeze`. `decoratorOrFactory` now matches `ContextDecorator`'s call shapes structurally and properties are typed via the assign intersection — no more `as unknown` escape hatch in the factory's return path.
  4. **Meaningful `.name` on the returned decorator.** `console.log(LoadTenant)` now prints `[Function: ContextDecorator(tenant)]` instead of `[Function: decoratorOrFactory]`. Stack traces and devtools inspections name the contributor by its key.
  5. **Stale-comment sweep.** Dropped the "No runtime behaviour is wired in Phase 1" line — Phase 1 shipped, the topo-sort + runner + HTTP integration are all live. Replaced with a concrete pointer to the new boot-time validation.
  6. **Documented unsound `as D` cast.** `Object.freeze({ ...(spec.deps ?? ({} as D)) })` carries an inline comment explaining when the cast is sound (zero-deps default), when it isn't (non-empty `D` with `deps` omitted), and why the runner's loud-fail behaviour is the right tradeoff vs forcing `deps` non-optional in the spec.

  `MissingContributorError` gained a fourth optional constructor argument (`dependentDefinedAt?: string`) and a matching readonly field. Existing callers continue to work — the parameter is optional and falls back to the previous message format when absent.

  Suite: 366 → 373 tests (+7 — six validation cases + one declared-at assertion). Build + typecheck clean.

## 5.4.0

### Minor Changes

- [#169](https://github.com/forinda/kick-js/pull/169) [`937f514`](https://github.com/forinda/kick-js/commit/937f514d282111299298acabad931c0e7de5c8c7) Thanks [@forinda](https://github.com/forinda)! - `RequestContext.body`, `params`, `query`, `headers`, `file`, and `files`
  are now typed `DeepReadonly<T>` (or `Readonly<T>` for headers,
  `ReadonlyArray<...>` for files). This is a **type-only** change — no
  runtime difference, no `Object.freeze`, no perf cost — but adopter code
  that mutates these in place will start failing at compile time, **once
  `ctx` is properly typed**:

  ```ts
  // Before — silently accepted, even when bypassing Zod validation
  ctx.body.injectedField = "computed";
  ctx.headers.authorization = "fake";
  ctx.files!.push(extra);

  // After — tsc errors
  //   "Cannot assign to 'injectedField' because it is a read-only property."
  //   "Cannot assign to 'authorization' because it is a read-only property."
  //   "Property 'push' does not exist on type 'readonly any[]'."
  ```

  This matches the framework's existing rule — _writes flow through
  `ctx.set(key, value)` or a Context Contributor's return value, not by
  mutating the request bag in place_ — and now the type system enforces
  it.

  ::: tip Protection only kicks in for typed contexts
  The default generic for `RequestContext` is `any`, and `DeepReadonly<any>`
  collapses to `any`. Adopters who write `ctx: RequestContext` get no
  protection (and no breakage). Adopters who write
  `ctx: Ctx<KickRoutes.UserController['create']>` (or pass explicit
  generics like `RequestContext<CreateUserBody>`) get the readonly
  locks the changeset describes. The CLI scaffolders (`kick g scaffold`,
  `kick g controller`) already emit `Ctx<KickRoutes…>` by default, so
  freshly generated controllers see the protection automatically.
  :::

  ### Migration

  Most usages already comply. If you mutate one of these surfaces
  intentionally, two escape hatches:

  1. **Compute and stash** (preferred):
     ```ts
     const enriched = { ...ctx.body, computed: f(ctx.body) };
     ctx.set("enrichedBody", enriched);
     ```
  2. **Drop down to the raw Express handle**:
     ```ts
     (ctx.req.body as any).injectedField = "computed";
     ```

  The escape hatches stay supported. The default just stops surprising
  adopters who validated a payload with Zod, then watched a downstream
  middleware silently mutate it.

  `ctx.session`, `ctx.user`, `ctx.cookies`, and `ctx.requestId` are
  unchanged — those have legitimate write-side flows (auth strategies,
  session stores, etc.) and wrapping them in `Readonly` would create
  real friction.

  A new `DeepReadonly<T>` type alias is exported from
  `@forinda/kickjs` for adopters who want to apply the same lock to
  their own typed payloads.

## 5.3.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.

  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

## 5.3.0

### Minor Changes

- [#161](https://github.com/forinda/kick-js/pull/161) [`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98) Thanks [@forinda](https://github.com/forinda)! - Add `withBuilder()` factory alongside `@Builder`. Both share the same runtime via the new internal `attachBuilder()` helper.

  ```ts
  // Decorator form — opt into typing with one line
  @Builder
  class UserDto {
    name!: string;
    email!: string;
    declare static readonly builder: () => BuilderOf<UserDto>;
  }

  // Factory form — same runtime, types inferred automatically
  class TaskDtoBase {
    title!: string;
    done!: boolean;
  }
  export const TaskDto = withBuilder(TaskDtoBase);
  export type TaskDto = InstanceType<typeof TaskDto>;
  ```

  `readonly` keeps SonarQube's `typescript:S1444` quiet — the runtime assigns `target.builder` once at decoration time and never reassigns it. Existing `@Builder` adopters keep working without changes; the typing opt-in is additive.
