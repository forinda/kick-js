---
description: The security model of a KickJS MCP server — what an exposed tool is, the checks on the endpoint and on each call, and what stays your responsibility.
---

# MCP Security

Exposing a route as an MCP tool is like exposing it to another HTTP client: the same route, called with the caller's credentials. Your existing authentication, permission checks and rate limits do the work. If you wouldn't make a route reachable from outside, don't make it a tool.

## What protects a tool call

**At the MCP endpoint**, every request:

- **Host and origin.** A request for a host outside `allowedHosts` gets 403. So does one from a browser origin outside `allowedOrigins`; clients that send no `Origin` (Claude Code, Cursor, the SDK) are unaffected. Together they stop web pages from reaching a server through DNS rebinding.
- **Authentication.** With `auth`, every request (`initialize`, `tools/list`, each `tools/call`) is checked, so a revoked token stops working at once. `authenticate` also checks the token's audience against this server's resource URL ([Authentication](./auth.md)).
- **Scopes.** A tool's `scopes` refuse a call from a principal without them, before it runs.
- **Which tools exist for this caller.** `toolFilter` hides tools a caller may not use, from the list and from calls ([Multi-Tenancy](./multi-tenant.md)).
- **Load.** In session mode, `maxSessions` caps open sessions (503 beyond it) and idle sessions close after `sessionIdleTimeoutMs`. `toolTimeoutMs` caps how long a call runs.

**In the route**, every tool call:

- runs through the route's full pipeline: middleware, contributors (your auth user loader, tenant resolution), guards, role checks, rate limits, validation and error mapping;
- carries the caller's `Authorization` and cookie headers (`forwardHeaders`), so the route authenticates the real caller, not the MCP server;
- reaches the route with the caller's host, so tenant resolution sees the right tenant.

**By construction:**

- **Explicit mode is the default.** Only routes you mark (`@McpTool` or an `exposeWhen` flag) become tools. `hideWhen` keeps a route out whatever else says, including controllers from plugins.
- **Arguments are validated by the route**, against its `params`, `query` and `body` schemas, like any request. A custom tool's arguments are validated against its `inputSchema` before the handler runs.

## What stays yours

- **Permissions.** Annotations (`destructiveHint`) are hints for clients, not enforcement, and `toolFilter` decides what's offered, not what's allowed. Keep the permission check in the route.
- **Approval for risky actions.** `ctx.elicit` can ask the user to confirm inside a custom tool ([Asking the user](./tools.md#asking-the-user-elicitation)). For actions that need sign-off inside your system, route them through your own approval flow and return a typed error (`McpToolError('approval_pending', …)`) the model can report.
- **The authorization server.** The adapter is the resource server: it validates tokens and serves metadata. Issuing them (sign-in, consent, refresh, revocation) is your identity provider's job.
- **Rate limits per caller.** Route-level rate limits apply to route tools. Custom tools need their own, or a check in the handler.
- **Isolation.** Tools run in your app's process with its permissions. For untrusted code, use an OS-level sandbox.

## Not yet supported

- **Prompts**, and resource subscriptions (`resources/subscribe`).
- **Sampling** (asking the client's model to generate text mid-call).
