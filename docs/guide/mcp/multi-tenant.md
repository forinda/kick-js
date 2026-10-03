---
description: Serving one MCP endpoint per tenant from a KickJS app — host per tenant, the tenant's host on tool calls, per-caller tool lists, allowed hosts, per-tenant OAuth and running behind a proxy.
---

# MCP Multi-Tenancy

A SaaS app usually wants each tenant at its own address, `https://<tenant>.example.com/mcp`, with every user seeing only the tools they may use. One adapter serves all of them: the tenant comes from the host, and the user from the token.

```ts
McpAdapter({
  name: 'acme-erp',
  path: '/mcp',
  stateless: true, // any instance can answer: see Deployment
  trustProxy: true, // behind a TLS proxy that sets X-Forwarded-Host / -Proto
  allowedHosts: (host) => host.endsWith('.example.com'),
  auth: { type: 'bearer', authenticate: verifyAccessToken },
  protectedResource: {
    authorizationServers: (req) => [`https://${req.host}/oauth`],
    scopesSupported: ['erp:read', 'erp:write'],
  },
  toolFilter: async (tool, call) => {
    const actions = await permissions.allowedActions(call.host, call.principal!.subject)
    return actions.has(tool.name)
  },
})
```

## The tenant comes from the host

Each request's host travels with it:

- **Route tools** are dispatched to the MCP request's own origin. A tool call to `acme.example.com` reaches your route with `Host: acme.example.com`, so the contributor or middleware that resolves the tenant from the host works unchanged. No header needs forwarding.
- **Custom tools** get `ctx.origin` (`https://acme.example.com`). Build requests to your routes from it: `new Request(new URL('/api/v1/x', ctx.origin))`.
- **Auth and filters** get `request.host` / `call.host`, and `resource` (`https://acme.example.com/mcp`): the value a token's audience must name.

## Behind a proxy: `trustProxy`

Behind a load balancer that terminates TLS, the app sees `http://` and maybe an internal host, so the resource URL would read `http://internal:3000/mcp` and every audience check would fail. `trustProxy: true` reads the scheme and host from `X-Forwarded-Proto` and `X-Forwarded-Host`.

Only set it when the proxy overwrites those headers on every request. Otherwise a client chooses the host it claims to be, and with it the tenant.

## Only your hosts: `allowedHosts`

```ts
allowedHosts: ['acme.example.com', 'globex.example.com'] // or a function
```

A request for any other host gets 403. With `allowedOrigins` (which refuses browser pages from other origins) it completes the DNS-rebinding defence the MCP spec asks for. A tenancy layer that already rejects unknown hosts covers this too; `allowedHosts` also protects the MCP endpoint itself.

## Per-caller tools: `toolFilter`

`toolFilter(tool, call)` decides, per request, whether a caller sees a tool:

```ts
toolFilter: (tool, call) => {
  // Read-only tools for everyone; the rest for the tenant's admins.
  if (tool.annotations?.readOnlyHint) return true
  return call.principal?.roles?.includes('admin') ?? false
}
```

| `tool.`                 | What it is                            |
| ----------------------- | ------------------------------------- |
| `name`, `description`   | as listed                             |
| `kind`                  | `'route'` or `'custom'`               |
| `annotations`, `scopes` | from `@McpTool` / the custom tool     |
| `route`                 | `{ method, path }` for a route tool   |
| `provider`              | the provider's name for a custom tool |

`call` has `principal`, `host`, `origin`, `resource` and `headers`.

The filter applies to both `tools/list` and `tools/call`: a tool a caller can't see answers like a tool that doesn't exist (JSON-RPC `-32602`), so it can't be called by guessing its name. It may be async, and it runs on every request, so cache slow lookups (a tenant's enabled modules, a user's permissions) for a few seconds. A filter that throws hides the tool and logs the error.

The filter decides what's offered. The route still enforces what's allowed: keep the permission check in the route, so a tool that slips through the filter is still refused.

## One authorization server per tenant

`protectedResource.authorizationServers` and `auth.resourceMetadataUrl` can be functions of the request. Each tenant then advertises its own authorization server, and each tenant's tokens carry its own audience:

```ts
protectedResource: {
  authorizationServers: (req) => [`https://${req.host}/oauth`],
}
```

## Putting it together: what one call does

1. A request reaches `https://acme.example.com/mcp` with `Authorization: Bearer <token>`.
2. The host is checked against `allowedHosts`, and the origin against `allowedOrigins`.
3. `authenticate` returns the principal. Its audience must be `https://acme.example.com/mcp`.
4. For `tools/list`, `toolFilter` picks this user's tools. For `tools/call`, it must allow the named tool, and the principal must hold the tool's `scopes`.
5. A route tool runs as a request to `https://acme.example.com/api/v1/...`, with the caller's `Authorization` header, through the route's tenancy, auth and permission checks.
