---
'@forinda/kickjs': patch
'@forinda/kickjs-ai': minor
'@forinda/kickjs-mcp': minor
---

Mount custom AI providers and MCP tool providers at any time.

- **AI:** `ai.registerProvider(name, provider)` and `unregisterProvider(name)` mount more `AiProvider`s next to the default (the provider `AiAdapter` was created with). `runAgent` / `runAgentWithMemory` take `provider` — a registered name or an instance — and `getProvider(name?)` returns one. Registering an existing name replaces it; the default's name is reserved.
- **MCP:** `mcp.registerProvider({ name, tools })` and `unregisterProvider(name)` mount tools that aren't controller routes. The new `McpToolProvider`, `McpCustomTool` and `McpToolContext` interfaces define them: a handler with arguments validated against `inputSchema` (any schema library) and a context carrying the MCP request's headers, the cancellation signal, and `fetch` into the app. Connected clients get `tools/list_changed` when providers change. The adapter is registered under the new `MCP_ADAPTER` token (`McpAdapterInstance` type) so plugins and modules can reach it.
- **`ctx.sendResponse`** flushes headers as soon as a streamed body starts, so SSE streams open for the client before their first event.
- The AI and MCP guides document both, with local example providers that also run as tests.
