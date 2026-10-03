---
description: Reference for @forinda/kickjs-mcp — every McpAdapter option, @McpTool and custom tool fields, the principal and call context, the adapter instance and exports.
---

# MCP Reference

## `McpAdapter(options)`

```ts
McpAdapter({
  name: 'billing', // required
  path: '/mcp',
  stateless: true,
  auth: { type: 'bearer', authenticate: verify },
  protectedResource: { authorizationServers: ['https://auth.example.com'] },
  toolFilter: (tool, call) => true,
})
```

### Server

| Option        | Default   | Notes                                                                                                             |
| ------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `name`        | required  | server name advertised to clients                                                                                 |
| `version`     | `'0.0.0'` | server version advertised to clients                                                                              |
| `description` | —         | shown in client UIs                                                                                               |
| `transport`   | `'http'`  | `'http'` (Streamable HTTP), `'stdio'`, or `'sse'` (a deprecated alias of `http`). `KICK_MCP_STDIO=1` forces stdio |

### Which routes are tools

| Option       | Default      | Notes                                                                                                        |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------------------ |
| `mode`       | `'explicit'` | `'explicit'`: only marked routes. `'auto'`: every route, filtered by `include` / `exclude`                   |
| `include`    | —            | `auto` mode: HTTP methods to expose                                                                          |
| `exclude`    | —            | `auto` mode: path patterns to skip; `'/admin/*'` also skips `/api/v1/admin/users`                            |
| `exposeWhen` | —            | routes carrying these [route flags](../route-flags.md) are tools; an object flag value supplies tool options |
| `hideWhen`   | —            | routes carrying these flags are never tools — wins over everything                                           |

### Endpoint

| Option                 | Default                      | Notes                                                                                 |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| `path`                 | `` `${basePath}/messages` `` | the full endpoint path                                                                |
| `basePath`             | `'/_mcp'`                    | used when `path` isn't set                                                            |
| `stateless`            | `false`                      | a fresh server per request, no sessions; `GET` / `DELETE` answer 405                  |
| `maxSessions`          | `1000`                       | session mode: open sessions beyond it get 503                                         |
| `sessionIdleTimeoutMs` | 30 minutes                   | session mode: close a session with nothing in progress after this long                |
| `allowedOrigins`       | `[]`                         | browser origins allowed (`'*'` for any); requests without `Origin` are always allowed |
| `allowedHosts`         | any                          | hosts served (a list or a function); others get 403                                   |
| `trustProxy`           | `false`                      | read the request's scheme and host from `X-Forwarded-Proto` / `-Host`                 |

### Auth

| Option                                   | Notes                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `auth.type`                              | `'bearer'`: the credential is the bearer token. `'custom'`: the raw `Authorization` value                |
| `auth.validate(credential)`              | return `true` to allow                                                                                   |
| `auth.authenticate(credential, request)` | return an `McpPrincipal`, or `null` to refuse. Use instead of `validate`                                 |
| `auth.resourceMetadataUrl`               | `resource_metadata` in the 401 challenge (string or function); defaults to the `protectedResource` route |
| `auth.scopes`                            | scopes named in the 401 challenge                                                                        |
| `protectedResource`                      | serve RFC 9728 metadata: `authorizationServers` (list or function), `scopesSupported`, `resource`        |

### Calls

| Option           | Default                                                                    | Notes                                                                   |
| ---------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `toolFilter`     | —                                                                          | `(tool, call) => boolean`: which tools a caller sees, for list and call |
| `forwardHeaders` | `['authorization', 'cookie', 'x-request-id', 'traceparent', 'tracestate']` | headers copied from the MCP request onto route tool calls               |
| `toolTimeoutMs`  | no limit                                                                   | end a call that runs longer, with a `timeout` error                     |

## `@McpTool(options)`

| Option         | Default                               | Notes                                                                           |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `description`  | required                              | what the tool does, for the model                                               |
| `name`         | `Controller.method`                   | unique across the server; `[A-Za-z0-9_.-]{1,128}`                               |
| `title`        | —                                     | a display name                                                                  |
| `inputSchema`  | the route's `params`, `query`, `body` | replaces the query/body input; path params are still added                      |
| `outputSchema` | —                                     | advertised in `tools/list`; a JSON object answer is sent as `structuredContent` |
| `annotations`  | —                                     | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`            |
| `scopes`       | —                                     | scopes the principal must hold; otherwise 403 `insufficient_scope`              |
| `examples`     | —                                     | example arguments and results                                                   |
| `hidden`       | `false`                               | leave out of `auto` mode                                                        |

A route flag's object value takes the same fields.

## Custom tools

`registerProvider({ name, tools })` mounts custom tools; registering a provider with the same name replaces it.

| Tool field                       | Notes                                                                  |
| -------------------------------- | ---------------------------------------------------------------------- |
| `name`                           | unique across the server                                               |
| `description`                    | for the model                                                          |
| `inputSchema`                    | any schema library; arguments are validated before the handler runs    |
| `outputSchema`                   | an object result is sent as `structuredContent`                        |
| `title`, `annotations`, `scopes` | as on `@McpTool`                                                       |
| `handler(args, ctx)`             | its return value is the result; throw `McpToolError` for a typed error |

`ctx` has `principal`, `origin`, `headers`, `signal` and `fetch(request)`.

## Types

| Type                | Shape                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `McpPrincipal`      | `{ subject, clientId?, scopes?, audience?, [key]: unknown }`                                                                                   |
| `McpRequestInfo`    | `{ headers, host, origin, resource }`                                                                                                          |
| `McpCallContext`    | `McpRequestInfo & { principal? }` — what `toolFilter` gets                                                                                     |
| `McpToolSummary`    | `{ name, description, kind: 'route' \| 'custom', scopes?, annotations?, route?, provider? }`                                                   |
| `McpToolDefinition` | a discovered route tool: `name`, `description`, `inputSchema`, `outputSchema?`, `httpMethod`, `mountPath`, `annotations?`, `title?`, `scopes?` |
| `McpToolError`      | `new McpToolError(code, message, data?)`                                                                                                       |

## The adapter instance

Resolve it with `container.resolve(MCP_ADAPTER)` (typed `McpAdapterInstance`), or keep the value `McpAdapter()` returned:

| Method                     | Does                                                                          |
| -------------------------- | ----------------------------------------------------------------------------- |
| `getTools()`               | the route tools discovered at startup                                         |
| `registerProvider(p)`      | mount custom tools; connected clients get `tools/list_changed` (session mode) |
| `unregisterProvider(name)` | unmount them; `false` when no such provider                                   |

## Exports

```ts
import {
  McpAdapter,
  McpTool,
  McpToolError,
  MCP_ADAPTER,
  getMcpToolMeta,
  isMcpTool,
  MCP_TOOL_METADATA,
} from '@forinda/kickjs-mcp'

import type {
  McpAdapterOptions,
  McpAdapterInstance,
  McpToolOptions,
  McpToolDefinition,
  McpCustomTool,
  McpToolContext,
  McpToolProvider,
  McpPrincipal,
  McpRequestInfo,
  McpCallContext,
  McpProtectedResourceOptions,
  McpToolAnnotations,
  McpToolSummary,
  McpAuthOptions,
  McpExposureMode,
  McpTransport,
  McpToolExample,
} from '@forinda/kickjs-mcp'
```
