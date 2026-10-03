---
'@forinda/kickjs-mcp': minor
---

A multi-tenant, per-user MCP surface. All of these are new options; nothing existing changes behaviour.

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
