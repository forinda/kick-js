---
'@forinda/kickjs-mcp': minor
'@forinda/kickjs-schema': patch
---

What MCP clients are told about a tool, made accurate:

- Tool input schemas describe what the tool accepts (`io: 'input'`): a `.default()` field is optional and a coerced or transformed field takes the type that's sent. This also fixes route tools in `@forinda/kickjs-ai`, which share `buildRouteTool`.
- `@McpTool({ examples })` reach `tools/list`, as the input schema's `examples`.
- A route tool's annotations start from its HTTP method (`GET` read-only and idempotent, `DELETE` destructive and idempotent, …); `annotations` override them.
- A `202 Accepted` answer is reported as accepted and never sent as `structuredContent`, so it isn't checked against the `outputSchema`.
- The 401 challenge says `error="invalid_token"` when a token was sent and refused.
- Transport errors use the SDK's codes: `-32001` for an unknown session, `-32603` for an internal error. An `outputSchema` that can't be converted is warned about instead of silently dropped.
