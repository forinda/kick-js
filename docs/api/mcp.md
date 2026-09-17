# @forinda/kickjs-mcp

Expose controller routes as [Model Context Protocol](https://modelcontextprotocol.io) tools for Claude Code, Claude Desktop, Cursor and other MCP clients. The [MCP guide](../guide/mcp.md) covers transports, auth patterns and the Inspector.

## Installation

<PmCommand add="@forinda/kickjs-mcp @modelcontextprotocol/sdk" />

## Exports

| Export              | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `McpAdapter`        | Adapter factory: discovers tools and serves the MCP endpoint |
| `@McpTool(opts)`    | Expose a controller method as a tool                         |
| `getMcpToolMeta`    | Read `@McpTool` options for a method                         |
| `isMcpTool`         | Whether a method carries `@McpTool`                          |
| `MCP_TOOL_METADATA` | Metadata key `@McpTool` writes                               |

Types: `McpAdapterOptions`, `McpTransport`, `McpExposureMode`, `McpAuthOptions`, `McpToolOptions`, `McpToolDefinition`, `McpToolExample`.

## McpAdapter options

| Option           | Type                         | Default                                                                | Description                                                                                          |
| ---------------- | ---------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `name`           | `string`                     | required                                                               | Server name shown to clients                                                                         |
| `version`        | `string`                     | `'0.0.0'`                                                              | Server version shown to clients                                                                      |
| `description`    | `string`                     | —                                                                      | Server description                                                                                   |
| `mode`           | `'explicit' \| 'auto'`       | `'explicit'`                                                           | `explicit`: only `@McpTool` (and `exposeWhen`) routes; `auto`: every route passing the filters       |
| `transport`      | `'http' \| 'stdio' \| 'sse'` | `'http'`                                                               | Streamable HTTP, stdio, or `sse` (deprecated alias of `http`)                                        |
| `basePath`       | `string`                     | `'/_mcp'`                                                              | Endpoint mount path (`{basePath}/messages`)                                                          |
| `include`        | `HTTP method[]`              | —                                                                      | Auto mode: methods to expose                                                                         |
| `exclude`        | `string[]`                   | —                                                                      | Auto mode: route paths to skip, matched against the full path (`'/admin/*'` skips `/api/v1/admin/…`) |
| `auth`           | `McpAuthOptions`             | —                                                                      | Checked on every MCP request; `401` on failure                                                       |
| `allowedOrigins` | `string[]`                   | `[]`                                                                   | Browser origins allowed to call the endpoint; other `Origin` headers get `403`                       |
| `forwardHeaders` | `string[]`                   | `authorization`, `cookie`, `x-request-id`, `traceparent`, `tracestate` | Headers copied from the MCP request onto tool calls                                                  |
| `exposeWhen`     | `RouteFlagTest`              | —                                                                      | Routes carrying these route flags become tools; an object flag value supplies tool options           |
| `hideWhen`       | `RouteFlagTest`              | —                                                                      | Routes carrying these route flags are never tools                                                    |

## @McpTool options

| Option         | Type               | Description                                                   |
| -------------- | ------------------ | ------------------------------------------------------------- |
| `description`  | `string`           | Required. What the tool does, for the model                   |
| `name`         | `string`           | Tool name (default `Controller.method`)                       |
| `inputSchema`  | any schema         | Replace the query/body input; path parameters are still added |
| `outputSchema` | any schema         | Documentation only                                            |
| `examples`     | `McpToolExample[]` | Usage examples                                                |
| `hidden`       | `boolean`          | Never expose this route, even in auto mode                    |

## Behaviour

- **Tool input** combines path parameters (required) with the route's `params`, `query` and `body` schemas from any supported schema library.
- **Tool calls** run through the app's request pipeline in-process (`AdapterContext.fetch`) — middleware, validation, guards and contributors apply, and no listening server is needed (`createHandler()` works).
- **Sessions:** each client gets its own session (`mcp-session-id`); unknown sessions get `404`.
- **Runtimes:** the endpoint works on Express, Fastify, h3 and h3 v2.

`McpAdapter` instances also expose `getTools()` — the discovered `McpToolDefinition[]`, used by `kick mcp --list` and tests.

## Related

- [MCP guide](../guide/mcp.md)
- [AI](./ai.md) — call the same routes from your own agent loop
- [Route flags](../guide/route-flags.md)
