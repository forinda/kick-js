# @forinda/kickjs-mcp

Expose controller routes as [Model Context Protocol](https://modelcontextprotocol.io) tools for Claude, Claude Code, Cursor and other MCP clients. Every option, field and type is in the [MCP reference](../guide/mcp/reference.md); the [MCP guide](../guide/mcp.md) covers how to use them.

## Installation

<PmCommand add="@forinda/kickjs-mcp @modelcontextprotocol/server" />

## Exports

| Export              | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `McpAdapter`        | Adapter factory: discovers tools and serves the MCP endpoint |
| `@McpTool(opts)`    | Expose a controller method as a tool                         |
| `McpToolError`      | Throw from a custom tool for a typed, machine-readable error |
| `MCP_ADAPTER`       | DI token for the adapter instance (`McpAdapterInstance`)     |
| `getMcpToolMeta`    | Read `@McpTool` options for a method                         |
| `isMcpTool`         | Whether a method carries `@McpTool`                          |
| `MCP_TOOL_METADATA` | Metadata key `@McpTool` writes                               |

Types: `McpResourceProvider`, `McpResource`, `McpResourceTemplate`, `McpResourceLink`, `McpResourceContext`, `McpResourceSummary`, `McpResourceReadResult`, `McpAdapterInstance`, `McpAdapterOptions`, `McpAuthOptions`, `McpPrincipal`, `McpRequestInfo`, `McpCallContext`, `McpProtectedResourceOptions`, `McpToolOptions`, `McpToolDefinition`, `McpToolAnnotations`, `McpToolSummary`, `McpCustomTool`, `McpToolContext`, `McpToolProvider`, `McpToolExample`, `McpExposureMode`, `McpTransport`.

## Behaviour in brief

- **Tool calls are requests to your routes**, run in-process through the full pipeline (middleware, contributors, guards, validation) with the caller's credentials and host. No listening server is needed.
- **Identity and access:** `auth.authenticate` returns the caller; `toolFilter` picks each caller's tools; tool `scopes` answer 403 `insufficient_scope`; `protectedResource` serves OAuth metadata.
- **Resources:** `registerResourceProvider` serves fixed URIs and URI templates, filtered per caller with `resourceFilter`.
- **Asking the user:** custom tools call `ctx.elicit` for a confirmation or a missing field.
- **Serving:** protocol 2026-07-28 and the 2025 revisions on one endpoint. 2025 clients get a session each, or `stateless: true` for several instances; stdio for local clients. Works on Express, Fastify, h3 and h3 v2.

## Related

- [MCP guide](../guide/mcp.md) and [reference](../guide/mcp/reference.md)
- [AI](./ai.md) — call the same routes from your own agent loop
- [Route flags](../guide/route-flags.md)
