# @forinda/kickjs-mcp

## 9.0.0

### Major Changes

- [#790](https://github.com/forinda/kick-js/pull/790) [`04defba`](https://github.com/forinda/kick-js/commit/04defba301bf450a0f9f4a50985ca63a618d8077) Thanks [@forinda](https://github.com/forinda)! - Moves to MCP SDK v2 and protocol 2026-07-28, and adds resources and elicitation.
  
  **Breaking:** the peer dependency is now `@modelcontextprotocol/server` `^2.3.0` instead of `@modelcontextprotocol/sdk`. Install it with `pnpm add @modelcontextprotocol/server` (or run `kick add mcp`), then remove `@modelcontextprotocol/sdk` unless you use it yourself. Tests that use the SDK client import `Client` and `StreamableHTTPClientTransport` from `@modelcontextprotocol/client`.
  
  - **Protocol 2026-07-28.** One endpoint serves both eras.
    - 2026-07-28 clients are served statelessly in either mode, and hear about list changes through `subscriptions/listen`.
    - 2025 clients keep their sessions, or get stateless serving under `stateless: true`.
    - Over stdio, the connection's first message picks the era.
  - **Resources.** `registerResourceProvider({ name, resources, templates })` serves fixed URIs and RFC 6570 URI templates.
    - Reads can go through your own routes with `ctx.fetch`.
    - `resourceFilter` decides what each caller sees.
    - A resource's `scopes` answer 403 `insufficient_scope`.
    - Connected clients get `resources/list_changed`.
  - **Elicitation.** A custom tool calls `ctx.elicit(key, { message, schema })` to ask the user mid-call, and gets the validated answer or `undefined`.
    - 2026-07-28 clients get `input_required` rounds; answers carried between rounds are HMAC-signed and bound to the caller.
    - 2025 sessions get real `elicitation/create` requests.
    - Set `requestStateKey` when several instances serve one endpoint.
  - Unknown tools still answer `-32602`, now as `ProtocolError` from the v2 SDK.

### Minor Changes

- [#788](https://github.com/forinda/kick-js/pull/788) [`267cbb3`](https://github.com/forinda/kick-js/commit/267cbb34ef6f04d743c9ba2c4eac19532896639b) Thanks [@forinda](https://github.com/forinda)! - A multi-tenant, per-user MCP surface. All of these are new options; nothing existing changes behaviour.
  
  - **`auth.authenticate(credential, request)`:** returns who is calling (`McpPrincipal`: `subject`, `clientId`, `scopes`, `audience`, …) instead of a yes/no.
    - A principal whose `audience` doesn't name this host's resource URL is refused, so a token for one tenant's server can't be used at another's.
    - Tool handlers read the caller as `ctx.principal`, filters as `call.principal`.
  - **OAuth challenges:** a 401 sends `WWW-Authenticate: Bearer resource_metadata="…", scope="…"` (`auth.resourceMetadataUrl`, `auth.scopes`). A tool's `scopes` refuse a call without them with 403 `error="insufficient_scope"`.
  - **`protectedResource`:** serves RFC 9728 metadata at `/.well-known/oauth-protected-resource` and at that path plus the endpoint path, per host.
  - **`toolFilter(tool, call)`:** decides which tools each caller sees. It applies to `tools/list` and `tools/call`, so a hidden tool answers like an unknown one.
  - **Tenant host on dispatch:** route tools are dispatched to the MCP request's own origin, so a tenant-per-host app sees the caller's host. Custom tools get `ctx.origin`. `trustProxy` believes `X-Forwarded-Proto` / `-Host`.
  - **`stateless: true`:** a fresh server per request and no session map, so it can scale across instances. `GET` / `DELETE` answer 405.
  - **`path`:** the full endpoint path (e.g. `'/mcp'`).
  - **`allowedHosts`:** completes the DNS-rebinding defence.
  - **Tool metadata:** tools take `annotations`, `title` and `scopes`. `outputSchema` is now advertised in `tools/list`, and a JSON object result is sent as `structuredContent`. An error route answer's Problem Details body is sent as `structuredContent` too.
  - **`McpToolError(code, message, data)`:** for typed, machine-readable custom tool errors.
  - **`toolTimeoutMs`:** sets a call timeout.
  - **Unknown tools:** an unknown (or filtered-out) tool now answers JSON-RPC error `-32602`, as the spec asks, instead of a tool error result.

### Patch Changes

- [#794](https://github.com/forinda/kick-js/pull/794) [`4a5c813`](https://github.com/forinda/kick-js/commit/4a5c8139cb65e834cf92eaecf6cb1cf70f964265) Thanks [@forinda](https://github.com/forinda)! - Accept `@forinda/kickjs` 9 as a peer (`>=8.5.0 <10.0.0`). Neither package uses the APIs kickjs 9 removes.

## 8.0.0

### Major Changes

- [#717](https://github.com/forinda/kick-js/pull/717) [`67afd95`](https://github.com/forinda/kick-js/commit/67afd9585383fedb114c237f288eca81f38b6e9f) Thanks [@forinda](https://github.com/forinda)! - Breaking changes in the AI and MCP packages, and how to migrate.
  
  **`@forinda/kickjs-ai`**
  
  - **`AnthropicProvider` needs `@anthropic-ai/sdk`.** Install it (`pnpm add @anthropic-ai/sdk`); the provider loads it on first use and throws a clear error without it. `OpenAIProvider` is unaffected.
  - **`AnthropicProviderOptions.apiVersion` is removed** — the SDK sets the API version. `apiKey` is optional (the SDK resolves credentials). The default model is `claude-opus-5` and `max_tokens` 64000; set `defaultChatModel` / `defaultMaxTokens` to keep the old values.
  - **Default tool names are `Controller_method`** (was `Controller.method`, which OpenAI and Anthropic reject). A custom provider, allowlist or prompt that relied on dotted default names must use the new names, or set `@AiTool({ name })` explicitly.
  - **Requires `@forinda/kickjs` 8.6.0** (for `AdapterContext.fetch` and `matchesFlagTest`), released in the same version run; the peer range is `<9.0.0`.
  - **Pinecone** stores document text under `_kick_content` (was `content`); records written before still read. Code reading the index's metadata directly should look for the new key.
  - `runAgentWithMemory` no longer saves tool calls whose results aren't persisted, and `SlidingWindowChatMemory` may keep slightly fewer than `maxMessages` so history starts at a user message.
  
  **`@forinda/kickjs-mcp`**
  
  - **Browser clients need `allowedOrigins`.** A request carrying an `Origin` header not in the list gets `403`. MCP clients that send no `Origin` (Claude Code, Cursor, the SDK) are unaffected. Add e.g. `allowedOrigins: ['http://localhost:6274']` for the Inspector web UI.
  - **`auth` is enforced** on every MCP request; it was accepted but ignored. Clients must send the credential `validate` expects.
  - **`McpToolDefinition.zodInputSchema` is removed**; `inputSchema` holds the JSON Schema.
  - **Default `transport` is `'http'`** (was `'sse'`, which behaved the same); `'sse'` still works.
  - **`exclude` matches the full route path**, so `'/admin/*'` now excludes `/api/v1/admin/...` — routes that were exposed by mistake no longer are.
  - **Peers:** `@forinda/kickjs` 8.6.0 or later below 9 (released in the same version run), `@modelcontextprotocol/sdk ^1.30.0`.

### Minor Changes

- [#723](https://github.com/forinda/kick-js/pull/723) [`0910a54`](https://github.com/forinda/kick-js/commit/0910a542758e180934b9bbf9df105f6a60d4bacd) Thanks [@forinda](https://github.com/forinda)! - Package hygiene for the AI and MCP packages.
  
  - **MCP default transport is now `'http'`** (Streamable HTTP), matching the docs. It was `'sse'`, which behaved the same but logged a deprecation warning on every boot; `'sse'` is still accepted as a deprecated alias.
  - `@forinda/kickjs` peer range is `>=8.5.0 <9.0.0` for both packages (it had no upper bound; the new features need the 8.6.0 released alongside). The MCP SDK peer is `^1.30.0`, the version the adapter is built and tested against (was `^1.0.0`).
  - `reflect-metadata` is no longer a dependency of either package; neither imports it.
  - `@forinda/kickjs-ai` no longer lists providers it doesn't ship (Gemini) in its keywords or docs.

- [#717](https://github.com/forinda/kick-js/pull/717) [`6032d65`](https://github.com/forinda/kick-js/commit/6032d653e91f3bbf2332e1fd3eb1d87d11cd4d08) Thanks [@forinda](https://github.com/forinda)! - Review fixes across the MCP / AI work.
  
  - **MCP sessions are bounded.** New `maxSessions` (default 1000; a new client beyond it gets `503`) and `sessionIdleTimeoutMs` (default 30 minutes with no request in progress; a client holding its notification stream open is not idle). Without them, repeated `initialize` requests could accumulate sessions without limit.
  - **`Application.fetch` forwarding:** the request body is streamed to the app instead of buffered in full, so body-size limits apply as it arrives; `x-forwarded-host` / `x-forwarded-proto` always come from the Request URL, never from caller headers; shutdown force-closes the forwarding server's connections.
  - **`ctx.sendResponse`** waits for the socket to drain when a write reports backpressure, so a slow client can't make a long stream buffer without bound.
  - **`assertFlagTest`** is exported; `McpAdapter` and `AiAdapter` use it to validate `exposeWhen` / `hideWhen` without running predicates at construction.
  - **AI:** every failed tool call is marked `isError` (including a missing path parameter); `defaults.signal` applies when a call passes none; `{{user.constructor.name}}`-style placeholders only read own properties; `PineconeVectorStore` rejects the reserved `_kick_content` metadata key.
  - Docs: `AdapterContext.fetch` is available from `beforeStart` on (routes aren't mounted in `beforeMount`); MCP Inspector steps no longer describe a single session.

- [#724](https://github.com/forinda/kick-js/pull/724) [`d87ad83`](https://github.com/forinda/kick-js/commit/d87ad839b60791f5a8bec9a56c90d948b99053f8) Thanks [@forinda](https://github.com/forinda)! - Mount custom AI providers and MCP tool providers at any time.
  
  - **AI:** `ai.registerProvider(name, provider)` and `unregisterProvider(name)` mount more `AiProvider`s next to the default (the provider `AiAdapter` was created with). `runAgent` / `runAgentWithMemory` take `provider` — a registered name or an instance — and `getProvider(name?)` returns one. Registering an existing name replaces it; the default's name is reserved.
  - **MCP:** `mcp.registerProvider({ name, tools })` and `unregisterProvider(name)` mount tools that aren't controller routes. The new `McpToolProvider`, `McpCustomTool` and `McpToolContext` interfaces define them: a handler with arguments validated against `inputSchema` (any schema library) and a context carrying the MCP request's headers, the cancellation signal, and `fetch` into the app. Connected clients get `tools/list_changed` when providers change. The adapter is registered under the new `MCP_ADAPTER` token (`McpAdapterInstance` type) so plugins and modules can reach it.
  - **`ctx.sendResponse`** flushes headers as soon as a streamed body starts, so SSE streams open for the client before their first event.
  - The AI and MCP guides document both, with local example providers that also run as tests.

- [#720](https://github.com/forinda/kick-js/pull/720) [`9bb9620`](https://github.com/forinda/kick-js/commit/9bb96203c5d5db06163ea76fe42daa67de861ebd) Thanks [@forinda](https://github.com/forinda)! - Tool calls run through the app without a listening server, on every runtime.
  
  - **`Application.fetch(request)` and `AdapterContext.fetch`** run a web `Request` through the app's full pipeline and return the `Response`, with no listening server: the runtime's native fetch on h3 v2, otherwise an in-process server bound to `127.0.0.1`, started on first use and closed by `shutdown()`. `createHandler()` now uses the same code.
  - **`ctx.sendResponse(response)`** sends a web `Response` — status, headers with every `Set-Cookie`, a streamed body — on Express, Fastify, h3 and h3 v2.
  - **MCP:** the endpoint uses the SDK's web-standard transport through `ctx.sendResponse`, so it works on Fastify (previously a 500) and h3 v2. Tool calls use `AdapterContext.fetch`, so they work under `createHandler()` (previously "HTTP server address not yet captured"). New `forwardHeaders` option copies headers from the MCP request onto tool calls (default `authorization`, `cookie`, `x-request-id`, `traceparent`, `tracestate`; previously only `authorization`); client cancellation aborts the call.
  - **AI:** tool calls use `AdapterContext.fetch`, so agents work under `createHandler()` and `createTestApp`. New `headers` option on `runAgent` / `runAgentWithMemory` sends the caller's credentials to tool routes; `signal` aborts in-flight tool calls. `setServerBaseUrl` still sends calls to a URL when set.

- [#717](https://github.com/forinda/kick-js/pull/717) [`8c50638`](https://github.com/forinda/kick-js/commit/8c50638619b6fe6a38cba0de971b73fcb6644461) Thanks [@forinda](https://github.com/forinda)! - Security and session fixes for the HTTP transport.
  
  - **`auth` is now enforced.** It was accepted but never checked, so the MCP endpoint was open. Every request to `/_mcp/messages` (initialize, `tools/list`, tool calls) is checked; failures get `401`, with `WWW-Authenticate: Bearer` for bearer auth. `bearer` passes the token to `validate`; `custom` passes the raw `Authorization` header.
  - **`Origin` is validated.** Requests that carry an `Origin` header must match the new `allowedOrigins` option, otherwise `403`. The default `[]` allows no browser origin; MCP clients that send no `Origin` (Claude Code, Cursor, the MCP SDK) are unaffected. If a browser-based client calls your MCP endpoint, add its origin.
  - **Several clients can connect.** Each client gets its own session; previously a second client got "Server already initialized" until the process restarted.
  - **`exclude` matches full route paths.** `'/admin/*'` now excludes `/api/v1/admin/...`; before, patterns were compared with the module mount path only and documented globs never matched.
  - Restarting the same adapter instance no longer registers every tool twice.

- [#718](https://github.com/forinda/kick-js/pull/718) [`2f2a9de`](https://github.com/forinda/kick-js/commit/2f2a9de51b5529a58e1a1c8825fb4c9fad1312be) Thanks [@forinda](https://github.com/forinda)! - Route tools take path parameters and any schema library.
  
  - **`buildRouteTool()` in `@forinda/kickjs-schema`** builds one tool input schema from a route's path parameters and its `params`, `query` and `body` schemas (Zod, Valibot, Yup, Standard Schema), and maps tool arguments back to a URL and body. Both adapters use it.
  - **Path parameters work.** They were missing from tool schemas, so a call to `PUT /tasks/:id` reached the route with `params.id === ':id'`. They are now required fields; a call without one returns a tool error instead of hitting the route.
  - **Non-Zod schemas work.** MCP tools with a Valibot, Yup or Standard Schema body made the whole MCP endpoint return 404; AI tools got an empty schema. `inputSchema` on `@McpTool` / `@AiTool` now accepts any supported schema, and `zod` is an optional peer.
  - **AI tool names are valid for providers.** The default was `Controller.method`, which OpenAI and Anthropic reject. It is now `Controller_method`; names outside `[A-Za-z0-9_-]{1,64}` are cleaned with a warning. MCP names keep `Controller.method`, which MCP allows.
  - **Duplicate tool names are skipped with an error log**, instead of (MCP) disabling every tool.
  - `McpToolDefinition.zodInputSchema` is removed. AI tools are rediscovered after `shutdown()` instead of listed twice.

- [#719](https://github.com/forinda/kick-js/pull/719) [`2e36473`](https://github.com/forinda/kick-js/commit/2e36473830435208ab6c383753a56b1d1fbf2d12) Thanks [@forinda](https://github.com/forinda)! - Route flags decide which routes become MCP and AI tools.
  
  - `McpAdapter` and `AiAdapter` take `exposeWhen` and `hideWhen`, in the same forms as `skipWhen` (a name, `'!name'`, a list, or a predicate). A route carrying an `exposeWhen` flag becomes a tool without `@McpTool` / `@AiTool` — on a method, a controller, or a module mount. `hideWhen` wins over the decorators, `exposeWhen` and MCP's `mode: 'auto'`, so a module can hide a controller it mounts but does not own.
  - A flag whose value is an object supplies tool options (`description`, `name`, and for MCP `hidden`), e.g. `defineRouteFlag<Partial<McpToolOptions>>('mcp.tool')`. The decorator on the method takes precedence.
  - A mixed-polarity flag list throws when the adapter is created.
  - `matchesFlagTest` is now exported from `@forinda/kickjs`, so packages evaluate flag tests the same way the framework does.

### Patch Changes

- Updated dependencies [[`2f2a9de`](https://github.com/forinda/kick-js/commit/2f2a9de51b5529a58e1a1c8825fb4c9fad1312be)]:
  - @forinda/kickjs-schema@0.2.0

## 7.0.2

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
- Updated dependencies [[`bfb9319`](https://github.com/forinda/kick-js/commit/bfb9319d0b9d66c80d874352e93f7c9afcbef4ab)]:
  - @forinda/kickjs-schema@0.1.4

## 7.0.1

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

- Updated dependencies [[`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783)]:
  - @forinda/kickjs-schema@0.1.3

## 7.0.0

### Patch Changes

- [#377](https://github.com/forinda/kick-js/pull/377) [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1) Thanks [@forinda](https://github.com/forinda)! - Migrate the queue and mcp adapters onto the engine-agnostic `ctx.http` facade (M2b), and export the `AdapterHttp` type from `@forinda/kickjs` so adapter authors can type against it.
  - `@forinda/kickjs-queue`: the `/_kick/queue/{panel,data}` routes now register via `ctx.http.route(...)` and respond through `ctx.html` / `ctx.json` instead of reaching for the raw Express `app` / `res`.
  - `@forinda/kickjs-mcp`: the StreamableHTTP transport endpoints (`<basePath>/messages`) now mount via `ctx.http.mount(...)` — all three verbs in one route table so the engine still auto-answers the OPTIONS preflight. The transport handler reaches `ctx.req` / `ctx.res` for the raw node request/response it needs.

  Behavior is unchanged under the default Express runtime. Swagger and devtools migrate in M2c.

## 7.0.0-alpha.0

### Patch Changes

- [#377](https://github.com/forinda/kick-js/pull/377) [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1) Thanks [@forinda](https://github.com/forinda)! - Migrate the queue and mcp adapters onto the engine-agnostic `ctx.http` facade (M2b), and export the `AdapterHttp` type from `@forinda/kickjs` so adapter authors can type against it.
  - `@forinda/kickjs-queue`: the `/_kick/queue/{panel,data}` routes now register via `ctx.http.route(...)` and respond through `ctx.html` / `ctx.json` instead of reaching for the raw Express `app` / `res`.
  - `@forinda/kickjs-mcp`: the StreamableHTTP transport endpoints (`<basePath>/messages`) now mount via `ctx.http.mount(...)` — all three verbs in one route table so the engine still auto-answers the OPTIONS preflight. The transport handler reaches `ctx.req` / `ctx.res` for the raw node request/response it needs.

  Behavior is unchanged under the default Express runtime. Swagger and devtools migrate in M2c.

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78)]:
  - @forinda/kickjs@5.18.0-alpha.0

## 6.0.2

### Patch Changes

- Updated dependencies [[`020c4d0`](https://github.com/forinda/kick-js/commit/020c4d05bc948907207b5e70d9ee9c2341bbb9c4), [`fd786f8`](https://github.com/forinda/kick-js/commit/fd786f8ef2bca43658b4263109d9f5f6977101a5)]:
  - @forinda/kickjs-schema@0.1.2

## 6.0.1

### Patch Changes

- Updated dependencies [[`edcdb33`](https://github.com/forinda/kick-js/commit/edcdb33bdcba2057dfa325fd8ca0474d73cdb50b)]:
  - @forinda/kickjs-schema@0.1.1

## 6.0.0

### Patch Changes

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

- Updated dependencies [[`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs-schema@0.1.0

## 6.0.0-alpha.0

### Patch Changes

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

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0
  - @forinda/kickjs-schema@0.1.0-alpha.0

## 5.2.3

### Patch Changes

- [#283](https://github.com/forinda/kick-js/pull/283) [`a46927e`](https://github.com/forinda/kick-js/commit/a46927e9102ea67d25df633df2a55d782ab23a3c) Thanks [@forinda](https://github.com/forinda)! - Fix 3 bugs blocking MCP HTTP transport and auth forwarding:
  1. **Route mount order** — `notFoundHandler` was registered before adapter `beforeStart` hooks, causing `/_mcp/messages` to 404. Swapped ordering so adapters mount routes before the catch-all.
  2. **Auth header dropped** — `buildMcpServer` didn't forward the SDK's `extra` parameter (carrying `requestInfo.headers`) to `dispatchTool`, so `Authorization` headers never reached the internal Express dispatch.
  3. **SDK callback signature mismatch** — `@modelcontextprotocol/sdk` uses `(args, extra)` when `inputSchema` is present but `(extra)` when absent. Tools backed by GET/DELETE routes silently lost auth headers.

  Context decorators (`@LoadUser`, `@LoadTenant`, etc.) now flow auth through MCP-dispatched calls identically to direct HTTP.

## 5.2.2

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

## 5.2.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.
