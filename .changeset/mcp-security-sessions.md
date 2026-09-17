---
'@forinda/kickjs-mcp': minor
---

Security and session fixes for the HTTP transport.

- **`auth` is now enforced.** It was accepted but never checked, so the MCP endpoint was open. Every request to `/_mcp/messages` (initialize, `tools/list`, tool calls) is checked; failures get `401`, with `WWW-Authenticate: Bearer` for bearer auth. `bearer` passes the token to `validate`; `custom` passes the raw `Authorization` header.
- **`Origin` is validated.** Requests that carry an `Origin` header must match the new `allowedOrigins` option, otherwise `403`. The default `[]` allows no browser origin; MCP clients that send no `Origin` (Claude Code, Cursor, the MCP SDK) are unaffected. If a browser-based client calls your MCP endpoint, add its origin.
- **Several clients can connect.** Each client gets its own session; previously a second client got "Server already initialized" until the process restarted.
- **`exclude` matches full route paths.** `'/admin/*'` now excludes `/api/v1/admin/...`; before, patterns were compared with the module mount path only and documented globs never matched.
- Restarting the same adapter instance no longer registers every tool twice.
