# @forinda/kickjs-ai

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

- [#721](https://github.com/forinda/kick-js/pull/721) [`580cde0`](https://github.com/forinda/kick-js/commit/580cde08a2e5dc4f9ba1e1d8ca6d10420dddc4d5) Thanks [@forinda](https://github.com/forinda)! - Providers follow the current Claude and OpenAI APIs.
  
  **`AnthropicProvider` is built on the official `@anthropic-ai/sdk`** — install it alongside `@forinda/kickjs-ai` (optional peer, loaded on first use).
  
  - Default model `claude-opus-5` (was `claude-opus-4-6`), default `max_tokens` 64000; every request streams, so large values don't time out.
  - **Thinking blocks are kept.** They come back on the new `ChatResponse.providerContent` and `runAgent` sends them back with the tool calls they led to; they were dropped before, which multi-step tool loops on thinking models need.
  - New options: `effort`, `thinkingDisplay`, `cache` (automatic prompt caching, on by default), `fallbacks` (`'default'` on Claude Opus 5 and Fable/Mythos 5 models: a declined request is re-run on Anthropic's recommended fallback model), `client` (a pre-configured SDK client). `apiKey` is optional; the SDK's credential resolution applies. `apiVersion` is removed.
  - `temperature` / `topP` are no longer sent to models that reject them (Opus 4.7+, Sonnet 5, Fable), with a warning; older models get one of the two.
  - Consecutive tool results go back in one user message, failed calls with `is_error`. All system messages are joined instead of keeping only the first.
  - Stop reasons are normalized (`stop`, `length`, `tool_call`, `content_filter`) and a refusal's category and explanation are on `ChatResponse.refusal`. Usage includes `cacheReadTokens` / `cacheWriteTokens`.
  - An error event mid-stream now throws; it used to end the stream as if it had finished. API errors are `ProviderError` with the HTTP status.
  
  **`OpenAIProvider`:** sends `max_completion_tokens` (`max_tokens` is deprecated and rejected by reasoning models); streams every parallel tool-call delta with its `index` and id (only the first was surfaced, and later deltas lost the id); requests usage on the final stream chunk; normalizes `tool_calls` to `tool_call`.
  
  **`runAgent`:** stops without running tool calls when a turn ends with `content_filter` or `length`, and returns `finishReason` / `refusal`. Failed tool calls are marked `isError`. `ChatOptions.effort`, `ChatChunk.finishReason` / `usage`, and `toolCallDelta.index` are new.

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

- [#722](https://github.com/forinda/kick-js/pull/722) [`8145ccb`](https://github.com/forinda/kick-js/commit/8145ccb335353f397455e795029f8d82aef52886) Thanks [@forinda](https://github.com/forinda)! - Memory, RAG store and prompt fixes.
  
  - **`runAgentWithMemory`** with the default `persistToolResults: false` saved assistant tool calls without their results, a history OpenAI and Anthropic reject on the next turn. The calls are no longer saved; the assistant's text is, and empty turns are skipped.
  - **`SlidingWindowChatMemory`** grew without bound (and duplicated the system prompt) at `maxMessages: 1`, and could open the history on an orphaned tool result or an assistant turn. The kept history now always starts at a user message.
  - **`QdrantVectorStore`:** creating an existing collection failed after a restart — it now checks first. Non-UUID document ids (`'doc-1'`) were rejected by Qdrant; they are stored under a deterministic UUIDv5 and searches return the original id. `deleteAll` deleted the whole collection (leaving nothing to write to with `skipSetup`); it now deletes the points. Collection names are URL-encoded.
  - **`PineconeVectorStore`:** a user metadata field named `content` overwrote the document text. The text is now stored under `_kick_content`; records with the text under `content` still read.
  - **`PgVectorStore`:** one failed schema setup failed every later call; it is retried.
  - **`RagService.augmentChatInput`:** `$&` or `` $` `` in retrieved text was read as a replacement pattern and corrupted the context.
  - **Prompts:** `{{user.name}}` resolves nested values (it was reported missing); warnings go through the framework logger.
  - **`AiAdapterOptions.defaults`** was ignored; it now applies to `runAgent`, per-call values winning.
  - **Provider HTTP helper:** an abort during retry backoff surfaced as the retried error instead of an abort, every backoff left an abort listener behind, and breaking out of a stream early left the upstream connection open.
- Updated dependencies [[`2f2a9de`](https://github.com/forinda/kick-js/commit/2f2a9de51b5529a58e1a1c8825fb4c9fad1312be)]:
  - @forinda/kickjs-schema@0.2.0

## 7.0.1

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

## 7.0.0

## 7.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78)]:
  - @forinda/kickjs@5.18.0-alpha.0

## 6.0.1

### Patch Changes

- [#368](https://github.com/forinda/kick-js/pull/368) [`eb4297f`](https://github.com/forinda/kick-js/commit/eb4297fdbc326415ae27b07d8564fb64dbe41753) Thanks [@forinda](https://github.com/forinda)! - Export `AI_ADAPTER` and the `AiAdapterInstance` type from the package root. Both are documented in the README and the adapter's own JSDoc as the way to inject the adapter (`@Inject(AI_ADAPTER) private ai: AiAdapterInstance`), but were missing from `src/index.ts` so the documented import didn't resolve.

## 6.0.0

## 6.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0

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
