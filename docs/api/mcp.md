# @forinda/kickjs-mcp

Expose controller routes as [Model Context Protocol](https://modelcontextprotocol.io) tools for Claude, Claude Code, Cursor and other MCP clients. The [MCP guide](../guide/mcp.md) covers how to use it; the [MCP reference](../guide/mcp/reference.md) has every option in depth.

## Installation

<PmCommand add="@forinda/kickjs-mcp @modelcontextprotocol/server" />

`zod` is an optional peer, needed only if you write schemas with it.

## Exports

| Export              | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `McpAdapter`        | Adapter factory: discovers tools and serves the MCP endpoint       |
| `@McpTool(opts)`    | Expose a controller method as a tool                               |
| `McpToolError`      | Throw from a custom tool for a typed, machine-readable error       |
| `MCP_ADAPTER`       | DI token for the adapter's public surface (`McpAdapterInstance`)   |
| `getMcpToolMeta`    | Read `@McpTool` options for a method (`undefined` when not a tool) |
| `isMcpTool`         | Whether a method carries `@McpTool`                                |
| `MCP_TOOL_METADATA` | Metadata token `@McpTool` writes (`createToken<McpToolOptions>`)   |

Types: `McpAdapterOptions`, `McpAdapterInstance`, `McpTransport`, `McpExposureMode`, `McpAuthOptions`, `McpPrincipal`, `McpRequestInfo`, `McpCallContext`, `McpProtectedResourceOptions`, `McpToolOptions`, `McpToolDefinition`, `McpToolAnnotations`, `McpToolSummary`, `McpToolExample`, `McpCustomTool`, `McpToolContext`, `McpToolProvider`, `McpResource`, `McpResourceTemplate`, `McpResourceLink`, `McpResourceContext`, `McpResourceSummary`, `McpResourceReadResult`, `McpResourceProvider`.

## McpAdapter

```ts
function McpAdapter(options: McpAdapterOptions): AppAdapter & McpAdapterInstance
```

```ts
import { bootstrap } from '@forinda/kickjs'
import { McpAdapter } from '@forinda/kickjs-mcp'

export const app = await bootstrap({
  modules,
  adapters: [McpAdapter({ name: 'task-api', version: '1.0.0' })],
})
```

### Options

| Option                 | Type                                                                                  | Default                                                                | Notes                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `name`                 | `string`                                                                              | required                                                               | Server name advertised to clients                                                                   |
| `version`              | `string`                                                                              | `'0.0.0'`                                                              |                                                                                                     |
| `description`          | `string`                                                                              | —                                                                      | Shown in MCP client UIs                                                                             |
| `mode`                 | `'explicit' \| 'auto'`                                                                | `'explicit'`                                                           | `explicit`: only `@McpTool` methods. `auto`: every route, filtered by `include` / `exclude`         |
| `transport`            | `'http' \| 'stdio' \| 'sse'`                                                          | `'http'`                                                               | `sse` is a deprecated alias of `http`                                                               |
| `include`              | `Array<'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'>`                              | —                                                                      | HTTP methods exposed in `auto` mode                                                                 |
| `exclude`              | `string[]`                                                                            | —                                                                      | Path patterns hidden in `auto` mode (`'/admin/*'`)                                                  |
| `basePath`             | `string`                                                                              | `'/_mcp'`                                                              |                                                                                                     |
| `path`                 | `string`                                                                              | `` `${basePath}/messages` ``                                           | Full endpoint path                                                                                  |
| `auth`                 | `McpAuthOptions`                                                                      | —                                                                      | `{ type: 'bearer' \| 'custom', validate }` or `{ type, authenticate }` returning an `McpPrincipal`  |
| `allowedOrigins`       | `string[]`                                                                            | `[]`                                                                   | Browser origins allowed; requests without `Origin` are always accepted                              |
| `allowedHosts`         | `string[] \| (host) => boolean`                                                       | any host                                                               | Other `Host` values get 403                                                                         |
| `trustProxy`           | `boolean`                                                                             | `false`                                                                | Read `X-Forwarded-Proto` / `X-Forwarded-Host`                                                       |
| `forwardHeaders`       | `string[]`                                                                            | `authorization`, `cookie`, `x-request-id`, `traceparent`, `tracestate` | Copied onto each tool call                                                                          |
| `maxSessions`          | `number`                                                                              | `1000`                                                                 | Extra clients get 503                                                                               |
| `sessionIdleTimeoutMs` | `number`                                                                              | 30 minutes                                                             |                                                                                                     |
| `stateless`            | `boolean`                                                                             | `false`                                                                | Fresh server per request, no sessions — for several instances                                       |
| `protectedResource`    | `McpProtectedResourceOptions`                                                         | —                                                                      | Serves OAuth protected-resource metadata (RFC 9728)                                                 |
| `toolFilter`           | `(tool: McpToolSummary, call: McpCallContext) => boolean \| Promise<boolean>`         | —                                                                      | Per-caller tool visibility; hidden tools can't be called                                            |
| `resourceFilter`       | `(resource: McpResourceSummary, call: McpCallContext) => boolean \| Promise<boolean>` | —                                                                      | Same, for resources and templates                                                                   |
| `toolTimeoutMs`        | `number`                                                                              | no limit                                                               |                                                                                                     |
| `requestStateKey`      | `string`                                                                              | random per process                                                     | 32+ byte key signing multi-step `ctx.elicit` state; set it when several instances share an endpoint |
| `exposeWhen`           | `RouteFlagTest`                                                                       | —                                                                      | Expose routes carrying these [route flags](../guide/route-flags.md) without `@McpTool`              |
| `hideWhen`             | `RouteFlagTest`                                                                       | —                                                                      | Never expose routes carrying these flags; wins over everything else                                 |

### Instance methods (`McpAdapterInstance`)

Resolve with `container.resolve(MCP_ADAPTER)` from a plugin or module.

| Method                             | Description                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `getTools()`                       | Tool definitions discovered at startup (`readonly McpToolDefinition[]`)                      |
| `registerProvider(provider)`       | Mount custom tools (`McpToolProvider`) at any time; same name replaces. Clients are notified |
| `unregisterProvider(name)`         | Unmount; `false` when no such provider                                                       |
| `registerResourceProvider(p)`      | Mount resources and URI templates (`McpResourceProvider`)                                    |
| `unregisterResourceProvider(name)` | Unmount; `false` when none has that name                                                     |

## @McpTool

```ts
function McpTool(options: McpToolOptions): MethodDecorator
```

`McpToolOptions`: `description` (required), `name` (defaults to `<Controller>.<method>`), `title`, `inputSchema`, `outputSchema`, `annotations`, `scopes`, `examples`, `hidden`. The input schema is built from the route's `params`, `query` and `body` schemas unless `inputSchema` replaces it.

```ts
@Post('/', { body: createTaskSchema })
@McpTool({ description: 'Create a new task', annotations: { idempotentHint: false } })
create(ctx: Ctx<KickRoutes.TaskController['create']>) {}
```

## Custom tools and resources

```ts
const mcp = container.resolve(MCP_ADAPTER)

mcp.registerProvider({
  name: 'reports',
  tools: [
    {
      name: 'monthly_report',
      description: 'Build the monthly revenue report',
      inputSchema: z.object({ month: z.string() }),
      handler: async ({ month }, ctx) => {
        const ok = await ctx.elicit('confirm', {
          message: `Build ${month}?`,
          schema: z.object({ confirm: z.boolean() }),
        })
        if (!ok?.confirm) throw new McpToolError('cancelled', 'User declined')
        return buildReport(month, ctx.signal)
      },
    },
  ],
})

mcp.registerResourceProvider({
  name: 'invoices',
  templates: [
    { uriTemplate: 'invoices://{id}', name: 'invoice', read: ({ id }) => loadInvoice(id) },
  ],
})
```

A handler's string result is sent as text, anything else as JSON; an `McpToolError(code, message, data?)` becomes an `isError` result with `{ error: { code, message, ...data } }` as `structuredContent`. `McpToolContext` carries `headers`, `principal`, `origin`, `signal`, `elicit()` and `fetch()` (run a `Request` through the app's own pipeline). Resource reads get the same context without `elicit`.

## Behaviour in brief

- **Tool calls are requests to your routes**, run in-process through the full pipeline (middleware, contributors, guards, validation) with the caller's credentials and host. No listening server is needed.
- **Identity and access:** `auth.authenticate` returns the caller; `toolFilter` picks each caller's tools; tool `scopes` answer 403 `insufficient_scope`; `protectedResource` serves OAuth metadata.
- **Serving:** protocol 2026-07-28 and the 2025 revisions on one endpoint. 2025 clients get a session each, or `stateless: true` for several instances; `stdio` for local clients.

## Related

- [MCP guide](../guide/mcp.md) and [reference](../guide/mcp/reference.md)
- [AI](./ai.md) — call the same routes from your own agent loop
- [Route flags](../guide/route-flags.md)
