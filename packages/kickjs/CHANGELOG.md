# @forinda/kickjs

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
  declare module '@forinda/kickjs' {
    interface ContextMeta {
      tenant: { id: string; name: string }
    } // typed ctx.get
    interface ContextKeys {
      session: true
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
    source: 'header' | 'subdomain'
  }>()({
    key: 'tenant',
    deps: { repo: TENANT_REPO }, // D inferred
    paramDefaults: { source: 'header' },
    resolve: (ctx, { repo }, params) => repo.findFor(ctx, params),
  })
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
    source: 'header' | 'subdomain'
  }>()({
    key: 'tenant',
    deps: { repo: TENANT_REPO }, // D inferred
    paramDefaults: { source: 'header' },
    resolve: (ctx, { repo }, params) => repo.findFor(ctx, params),
  })
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
      https://forinda.github.io/kick-js/guide/dependency-injection#registering-services
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
    type: 'https://api.example.com/problems/out-of-credit',
    status: 403,
    detail: 'Your balance is 30, but that costs 50.',
    balance: 30, // extension per §3.2
  })

  ctx.problem.notFound({ detail: 'User abc not found' })
  ctx.problem.validation(zodResult.error.issues)
  ```

  Each call sets `Content-Type: application/problem+json` and fills in defaults (`type` → `about:blank` per §3.1.1, `title` → IANA reason phrase per §3.1.4). Shortcuts: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `tooManyRequests`, `internal`, plus the generic `ctx.problem({ status, ... })`.

  **`ProblemException`** — throw-from-anywhere class:

  ```ts
  throw ProblemException.forbidden({
    type: 'https://api.example.com/problems/out-of-credit',
    detail: 'Your balance is 30, but that costs 50.',
    balance: 30,
  })
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
    name: 'MyAdapter',
    build: () => ({
      introspect() {
        // Return-type fully inferred — no `import type` needed.
        return {
          protocolVersion: 1,
          name: 'MyAdapter',
          kind: 'adapter',
          state: { connectedAt: Date.now() },
          memoryBytes: 12_345,
          tokens: { provides: ['REDIS'], requires: [] },
          version: '1.0',
          metrics: { activeConnections: 3 },
        }
      },
    }),
  })
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
    @Autowired(DB) private db1!: KickDbClient
    @Inject(DB) private db2!: KickDbClient

    // Constructor parameter position — both names work.
    constructor(
      @Autowired(LOGGER) private logger: Logger,
      @Inject(CACHE) private cache: Cache,
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
  import { Controller, Get, Autowired, type RequestContext } from '@forinda/kickjs'
  import { TasksRepository } from './tasks.repository'

  @Controller()
  export class TasksController {
    @Autowired() private readonly tasks!: TasksRepository

    @Get('/:id/full')
    async showFull(ctx: RequestContext) {
      const row = await this.tasks.findFullById(ctx.params.id as string, ctx.signal)
      if (!row) return ctx.notFound()
      ctx.json(row)
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
    name: 'TasksModule',
    defaults: { scope: 'public' },
    build: (config, { name }) => ({
      register(container) {
        container.registerInstance(`tasks:scope:${name}`, config.scope)
      },
      routes() {
        return { path: `/${config.scope}/tasks`, controller: TasksController }
      },
      contributors() {
        return [LoadTenant.registration]
      },
    }),
  })

  bootstrap({
    modules: [
      TasksModule(), // public scope (defaults)
      TasksModule.scoped('admin', { scope: 'admin' }), // namespaced clone
    ],
  })
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
  import { bootstrap, defineModules } from '@forinda/kickjs'

  const modules = defineModules().mount(HelloModule()).mount(TasksModule()).mount(AdminModule())

  await bootstrap({ modules })
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
  import { bootstrap } from '@forinda/kickjs'

  await bootstrap({
    modules: [HelloModule()], // static — always mounted

    setup(registry) {
      if (process.env.ENABLE_ADMIN === 'true') {
        registry.mount(AdminModule())
      }
      for (const tenant of TENANTS) {
        registry.mount(TenantModule.scoped(tenant.id, tenant))
      }
    },
  })
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
  ctx.body.injectedField = 'computed'
  ctx.headers.authorization = 'fake'
  ctx.files!.push(extra)

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
     const enriched = { ...ctx.body, computed: f(ctx.body) }
     ctx.set('enrichedBody', enriched)
     ```
  2. **Drop down to the raw Express handle**:
     ```ts
     ;(ctx.req.body as any).injectedField = 'computed'
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
    name!: string
    email!: string
    declare static readonly builder: () => BuilderOf<UserDto>
  }

  // Factory form — same runtime, types inferred automatically
  class TaskDtoBase {
    title!: string
    done!: boolean
  }
  export const TaskDto = withBuilder(TaskDtoBase)
  export type TaskDto = InstanceType<typeof TaskDto>
  ```

  `readonly` keeps SonarQube's `typescript:S1444` quiet — the runtime assigns `target.builder` once at decoration time and never reassigns it. Existing `@Builder` adopters keep working without changes; the typing opt-in is additive.
