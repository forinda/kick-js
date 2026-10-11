# @forinda/kickjs-schema

## 0.2.4

### Patch Changes

- [#838](https://github.com/forinda/kick-js/pull/838) [`5cb0dd1`](https://github.com/forinda/kick-js/commit/5cb0dd146091d820db41b303b88301a379c9be55) Thanks [@forinda](https://github.com/forinda)! - Schema detection fixes, and docs that match the code.
  
  - **Callable Standard Schemas:** schemas such as ArkType types are now validated as Standard Schemas. Before, they were treated as plain validator functions, which accepted every value because they return errors instead of throwing.
  - **Standard JSON Schema `target` and `io`:** libraries now receive the caller's `target` (default `'draft-2020-12'`) through `jsonSchema.input()` / `output()`, chosen by `io`. Swagger's `openapi-3.0` reaches them, and spec-compliant libraries no longer throw for a missing `target`.
  - **Valibot `expected` / `received`:** issues no longer carry the literal string `"null"` when Valibot reports none.
  - **`@valibot/to-json-schema`:** now a declared optional peer, installed by `kick new`'s Valibot template. Without it, Valibot schemas are still described as `{ type: 'object' }`, but a one-time warning now says why.
  - **CLI:** `kick g config` writes `schemaValidator: 'kickjs-schema'` like `kick new`. Generated Zod DTOs pass messages as `{ error: '…' }` (Zod 4).
  - **Generated README:** explains reading env: the schema in `src/config/index.ts` is imported once for its side effect, then values are read anywhere with `getEnv()`, `ConfigService` or `@Value()` (typed with `Env<'KEY'>`) rather than `process.env`. The variable table now lists `LOG_LEVEL`.
  - **Generated agent docs:** no longer call `@Controller('/path')` "OpenAPI metadata only". The path was removed in v4 and passing one is a TypeScript error.

## 0.2.3

### Patch Changes

- [#825](https://github.com/forinda/kick-js/pull/825) [`f191bb6`](https://github.com/forinda/kick-js/commit/f191bb68a939f2a7e83d5f702332bb45c990d17d) Thanks [@forinda](https://github.com/forinda)! - What MCP clients are told about a tool, made accurate:
  
  - Tool input schemas describe what the tool accepts (`io: 'input'`): a `.default()` field is optional and a coerced or transformed field takes the type that's sent. This also fixes route tools in `@forinda/kickjs-ai`, which share `buildRouteTool`.
  - `@McpTool({ examples })` reach `tools/list`, as the input schema's `examples`.
  - A route tool's annotations start from its HTTP method (`GET` read-only and idempotent, `DELETE` destructive and idempotent, …); `annotations` override them.
  - A `202 Accepted` answer is reported as accepted and never sent as `structuredContent`. On a tool with an `outputSchema` it's marked `isError`, since clients check a success against that schema.
  - The bearer 401 challenge says `error="invalid_token"` when a token was sent and refused.
  - Transport errors use the SDK's codes: `-32001` for an unknown session, `-32603` for an internal error; other refusals keep `-32000`. An `outputSchema` that can't be converted is warned about instead of silently dropped.

## 0.2.2

### Patch Changes

- [#811](https://github.com/forinda/kick-js/pull/811) [`0c3aec0`](https://github.com/forinda/kick-js/commit/0c3aec0eab81e8c58605e4c2f3a044b56f70d5cb) Thanks [@forinda](https://github.com/forinda)! - `z.date()` (and `z.coerce.date()`, bigints, Maps, Sets, transforms, custom types) no longer drop a schema from the OpenAPI spec. Zod and Valibot threw on them, and the builder silently left the request body out — or copied the validator's own object into a response. Now dates are documented as `date-time` strings, bigints as integers (`int64` for `z.int64()`, the one held to that range), and the rest as any value. A request schema with a plain `z.date()` / `z.bigint()` (or Valibot's) gets a one-time warning: JSON can't send a `Date` or `bigint`, so it rejects every request — use `z.coerce.date()` / `z.iso.datetime()`; Yup dates get the format too, and Yup types JSON Schema has no name for are untyped instead of invalid.
  
  The spec is also correct OpenAPI 3.0 now: `target` reaches the adapters, so a nullable field is `nullable: true`, not `type: ['string', 'null']`. Requests are described by what they accept and responses by what they return (a field with a default isn't required in a body), recursive schemas point at their own component instead of `#`, and a schema that fails to convert is reported instead of vanishing.

## 0.2.1

### Patch Changes

- [#801](https://github.com/forinda/kick-js/pull/801) [`c7c67b5`](https://github.com/forinda/kick-js/commit/c7c67b561cb92259a40f78e56c7135cc02dbcef2) Thanks [@forinda](https://github.com/forinda)! - Shorter README pointing to the documentation site.

## 0.2.0

### Minor Changes

- [#718](https://github.com/forinda/kick-js/pull/718) [`2f2a9de`](https://github.com/forinda/kick-js/commit/2f2a9de51b5529a58e1a1c8825fb4c9fad1312be) Thanks [@forinda](https://github.com/forinda)! - Route tools take path parameters and any schema library.
  
  - **`buildRouteTool()` in `@forinda/kickjs-schema`** builds one tool input schema from a route's path parameters and its `params`, `query` and `body` schemas (Zod, Valibot, Yup, Standard Schema), and maps tool arguments back to a URL and body. Both adapters use it.
  - **Path parameters work.** They were missing from tool schemas, so a call to `PUT /tasks/:id` reached the route with `params.id === ':id'`. They are now required fields; a call without one returns a tool error instead of hitting the route.
  - **Non-Zod schemas work.** MCP tools with a Valibot, Yup or Standard Schema body made the whole MCP endpoint return 404; AI tools got an empty schema. `inputSchema` on `@McpTool` / `@AiTool` now accepts any supported schema, and `zod` is an optional peer.
  - **AI tool names are valid for providers.** The default was `Controller.method`, which OpenAI and Anthropic reject. It is now `Controller_method`; names outside `[A-Za-z0-9_-]{1,64}` are cleaned with a warning. MCP names keep `Controller.method`, which MCP allows.
  - **Duplicate tool names are skipped with an error log**, instead of (MCP) disabling every tool.
  - `McpToolDefinition.zodInputSchema` is removed. AI tools are rediscovered after `shutdown()` instead of listed twice.

## 0.1.4

### Patch Changes

- [#604](https://github.com/forinda/kick-js/pull/604) [`bfb9319`](https://github.com/forinda/kick-js/commit/bfb9319d0b9d66c80d874352e93f7c9afcbef4ab) Thanks [@forinda](https://github.com/forinda)! - README corrections and cuts — a version bump so they reach npm.
  
  The README is what npmjs.com renders, and it ships in the tarball, so a fix
  only reaches readers on a publish. These four packages have no code change in
  this release; the bump exists to publish the README.
  
  - **mcp** — `@Roles('admin')` and `@Public()` came from `@forinda/kickjs-auth`,
    which no longer exists. Five passages described the adapter as running an
    "Express pipeline"; it dispatches through the shared HTTP pipeline on any
    runtime. Cut 560 → 176 lines: the auth-pattern walkthrough, three ASCII
    diagrams, the troubleshooting table and an alternative the README itself
    called not-recommended are all in the guide.
  - **schema** — cut 283 → 132. Per-adapter internals, two resolution orders and
    a full Joi adapter implementation live in the guide; the `KickSchema`
    interface and the subpath table, which are the decisions, stay.
  - **grpc** — cut 206 → 121. Kept the protocol-support table.
  - **devtools-kit** — the recommended dependency shape said `>=5.0.0` / `^5.0.0`
    for a package published at 7.0.1.
  
  `@forinda/kickjs`, `-cli` and `-testing` also had README changes and are
  already bumping in this release, so they need no entry here.

## 0.1.3

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

## 0.1.2

### Patch Changes

- [#304](https://github.com/forinda/kick-js/pull/304) [`020c4d0`](https://github.com/forinda/kick-js/commit/020c4d05bc948907207b5e70d9ee9c2341bbb9c4) Thanks [@forinda](https://github.com/forinda)! - Fix module-load crash when the `valibot` peer is not installed. `packages/schema/src/adapters/valibot.ts` static-imported `valibot` at the top of the file, so any consumer of `@forinda/kickjs-schema` (including the CLI, which loads `detect.ts` which static-imports every adapter) crashed with `ERR_MODULE_NOT_FOUND` when the peer was absent — even adopters who only used Zod paid the cost.

  Switched to top-level `await import('valibot')` inside try/catch (same pattern as the `@valibot/to-json-schema` fix in 0.1.1). When the peer is absent `v` lands at `null` and `fromValibot()` throws a clear error message at call time. When present, behaviour is identical to before.

  `isValibotSchema()` works without the peer (pure duck-type), so `detectSchema()` can still skip past a non-Valibot input on a Zod-only project.

- [#302](https://github.com/forinda/kick-js/pull/302) [`fd786f8`](https://github.com/forinda/kick-js/commit/fd786f8ef2bca43658b4263109d9f5f6977101a5) Thanks [@forinda](https://github.com/forinda)! - Fix race condition where `fromValibot(...).toJsonSchema()` returned the `{ type: 'object' }` fallback on fast runners (CI). The previous dangling `import('@valibot/to-json-schema').then(...)` resolved asynchronously, so the first `toJsonSchema()` call frequently fired before `_toJsonSchemaFn` got assigned. Replaced with top-level `await import(...)` inside a try/catch — adopters without the peer still land at the same `_toJsonSchemaFn = null` fallback, but adopters who have it installed get the real conversion every time.

## 0.1.1

### Patch Changes

- [#302](https://github.com/forinda/kick-js/pull/302) [`edcdb33`](https://github.com/forinda/kick-js/commit/edcdb33bdcba2057dfa325fd8ca0474d73cdb50b) Thanks [@forinda](https://github.com/forinda)! - Fix race condition where `fromValibot(...).toJsonSchema()` returned the `{ type: 'object' }` fallback on fast runners (CI). The previous dangling `import('@valibot/to-json-schema').then(...)` resolved asynchronously, so the first `toJsonSchema()` call frequently fired before `_toJsonSchemaFn` got assigned. Replaced with top-level `await import(...)` inside a try/catch — adopters without the peer still land at the same `_toJsonSchemaFn = null` fallback, but adopters who have it installed get the real conversion every time.

## 0.1.0

### Minor Changes

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

## 0.1.0-alpha.0

### Minor Changes

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
