---
'@forinda/kickjs': patch
'@forinda/kickjs-mcp': patch
---

Fix 3 bugs blocking MCP HTTP transport and auth forwarding:

1. **Route mount order** — `notFoundHandler` was registered before adapter `beforeStart` hooks, causing `/_mcp/messages` to 404. Swapped ordering so adapters mount routes before the catch-all.
2. **Auth header dropped** — `buildMcpServer` didn't forward the SDK's `extra` parameter (carrying `requestInfo.headers`) to `dispatchTool`, so `Authorization` headers never reached the internal Express dispatch.
3. **SDK callback signature mismatch** — `@modelcontextprotocol/sdk` uses `(args, extra)` when `inputSchema` is present but `(extra)` when absent. Tools backed by GET/DELETE routes silently lost auth headers.

Context decorators (`@LoadUser`, `@LoadTenant`, etc.) now flow auth through MCP-dispatched calls identically to direct HTTP.
