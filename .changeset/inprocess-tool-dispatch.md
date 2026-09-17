---
'@forinda/kickjs': minor
'@forinda/kickjs-mcp': minor
'@forinda/kickjs-ai': minor
---

Tool calls run through the app without a listening server, on every runtime.

- **`Application.fetch(request)` and `AdapterContext.fetch`** run a web `Request` through the app's full pipeline and return the `Response`, with no listening server: the runtime's native fetch on h3 v2, otherwise an in-process server bound to `127.0.0.1`, started on first use and closed by `shutdown()`. `createHandler()` now uses the same code.
- **`ctx.sendResponse(response)`** sends a web `Response` — status, headers with every `Set-Cookie`, a streamed body — on Express, Fastify, h3 and h3 v2.
- **MCP:** the endpoint uses the SDK's web-standard transport through `ctx.sendResponse`, so it works on Fastify (previously a 500) and h3 v2. Tool calls use `AdapterContext.fetch`, so they work under `createHandler()` (previously "HTTP server address not yet captured"). New `forwardHeaders` option copies headers from the MCP request onto tool calls (default `authorization`, `cookie`, `x-request-id`, `traceparent`, `tracestate`; previously only `authorization`); client cancellation aborts the call.
- **AI:** tool calls use `AdapterContext.fetch`, so agents work under `createHandler()` and `createTestApp`. New `headers` option on `runAgent` / `runAgentWithMemory` sends the caller's credentials to tool routes; `signal` aborts in-flight tool calls. `setServerBaseUrl` still sends calls to a URL when set.
