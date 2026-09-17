---
'@forinda/kickjs-schema': minor
'@forinda/kickjs-mcp': minor
'@forinda/kickjs-ai': minor
---

Route tools take path parameters and any schema library.

- **`buildRouteTool()` in `@forinda/kickjs-schema`** builds one tool input schema from a route's path parameters and its `params`, `query` and `body` schemas (Zod, Valibot, Yup, Standard Schema), and maps tool arguments back to a URL and body. Both adapters use it.
- **Path parameters work.** They were missing from tool schemas, so a call to `PUT /tasks/:id` reached the route with `params.id === ':id'`. They are now required fields; a call without one returns a tool error instead of hitting the route.
- **Non-Zod schemas work.** MCP tools with a Valibot, Yup or Standard Schema body made the whole MCP endpoint return 404; AI tools got an empty schema. `inputSchema` on `@McpTool` / `@AiTool` now accepts any supported schema, and `zod` is an optional peer.
- **AI tool names are valid for providers.** The default was `Controller.method`, which OpenAI and Anthropic reject. It is now `Controller_method`; names outside `[A-Za-z0-9_-]{1,64}` are cleaned with a warning. MCP names keep `Controller.method`, which MCP allows.
- **Duplicate tool names are skipped with an error log**, instead of (MCP) disabling every tool.
- `McpToolDefinition.zodInputSchema` is removed. AI tools are rediscovered after `shutdown()` instead of listed twice.
