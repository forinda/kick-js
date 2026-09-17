---
'@forinda/kickjs': patch
'@forinda/kickjs-mcp': minor
'@forinda/kickjs-ai': patch
---

Review fixes across the MCP / AI work.

- **MCP sessions are bounded.** New `maxSessions` (default 1000; a new client beyond it gets `503`) and `sessionIdleTimeoutMs` (default 30 minutes with no request in progress; a client holding its notification stream open is not idle). Without them, repeated `initialize` requests could accumulate sessions without limit.
- **`Application.fetch` forwarding:** the request body is streamed to the app instead of buffered in full, so body-size limits apply as it arrives; `x-forwarded-host` / `x-forwarded-proto` always come from the Request URL, never from caller headers; shutdown force-closes the forwarding server's connections.
- **`ctx.sendResponse`** waits for the socket to drain when a write reports backpressure, so a slow client can't make a long stream buffer without bound.
- **`assertFlagTest`** is exported; `McpAdapter` and `AiAdapter` use it to validate `exposeWhen` / `hideWhen` without running predicates at construction.
- **AI:** every failed tool call is marked `isError` (including a missing path parameter); `defaults.signal` applies when a call passes none; `{{user.constructor.name}}`-style placeholders only read own properties; `PineconeVectorStore` rejects the reserved `_kick_content` metadata key.
- Docs: `AdapterContext.fetch` is available from `beforeStart` on (routes aren't mounted in `beforeMount`); MCP Inspector steps no longer describe a single session.
