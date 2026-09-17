---
'@forinda/kickjs-ai': major
'@forinda/kickjs-mcp': major
---

Breaking changes in the AI and MCP packages, and how to migrate.

**`@forinda/kickjs-ai`**

- **`AnthropicProvider` needs `@anthropic-ai/sdk`.** Install it (`pnpm add @anthropic-ai/sdk`); the provider loads it on first use and throws a clear error without it. `OpenAIProvider` is unaffected.
- **`AnthropicProviderOptions.apiVersion` is removed** — the SDK sets the API version. `apiKey` is optional (the SDK resolves credentials). The default model is `claude-opus-5` and `max_tokens` 64000; set `defaultChatModel` / `defaultMaxTokens` to keep the old values.
- **Default tool names are `Controller_method`** (was `Controller.method`, which OpenAI and Anthropic reject). A custom provider, allowlist or prompt that relied on dotted default names must use the new names, or set `@AiTool({ name })` explicitly.
- **`@forinda/kickjs` peer is `>=8.6.0 <9.0.0`** (for `AdapterContext.fetch` and `matchesFlagTest`).
- **Pinecone** stores document text under `_kick_content` (was `content`); records written before still read. Code reading the index's metadata directly should look for the new key.
- `runAgentWithMemory` no longer saves tool calls whose results aren't persisted, and `SlidingWindowChatMemory` may keep slightly fewer than `maxMessages` so history starts at a user message.

**`@forinda/kickjs-mcp`**

- **Browser clients need `allowedOrigins`.** A request carrying an `Origin` header not in the list gets `403`. MCP clients that send no `Origin` (Claude Code, Cursor, the SDK) are unaffected. Add e.g. `allowedOrigins: ['http://localhost:6274']` for the Inspector web UI.
- **`auth` is enforced** on every MCP request; it was accepted but ignored. Clients must send the credential `validate` expects.
- **`McpToolDefinition.zodInputSchema` is removed**; `inputSchema` holds the JSON Schema.
- **Default `transport` is `'http'`** (was `'sse'`, which behaved the same); `'sse'` still works.
- **`exclude` matches the full route path**, so `'/admin/*'` now excludes `/api/v1/admin/...` — routes that were exposed by mistake no longer are.
- **Peers:** `@forinda/kickjs >=8.6.0 <9.0.0`, `@modelcontextprotocol/sdk ^1.30.0`.
