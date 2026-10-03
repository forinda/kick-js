---
description: Expose a KickJS app as an MCP server — install, wire up the adapter, how tool calls run through your routes, and guides to tools, auth, multi-tenancy, deployment, testing and security.
---

# MCP (Model Context Protocol)

`@forinda/kickjs-mcp` exposes a KickJS application as an [MCP](https://modelcontextprotocol.io/) server. Any client that speaks MCP (Claude, Claude Code, Cursor, Zed and others) can discover your routes as tools, read their input schemas, and call them.

What sets it apart from a hand-built MCP server: **a tool call is a request to your route**. It runs through your middleware, auth, tenancy, guards and validation, with the caller's credentials and host. You don't write a second, MCP-only implementation of each action, or a second permission system.

## Install

<PmCommand add="@forinda/kickjs-mcp" />

The package depends on `@modelcontextprotocol/sdk` and `@forinda/kickjs`.

## Wire up the adapter

```ts
import { bootstrap } from '@forinda/kickjs'
import { McpAdapter } from '@forinda/kickjs-mcp'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    McpAdapter({
      name: 'task-api',
      version: '1.0.0',
      description: 'Task management MCP server',
      mode: 'explicit',
      transport: 'http',
    }),
  ],
})
```

That's it. On startup the adapter walks every registered controller,
builds an `McpToolDefinition[]` from the route metadata, and attaches
an MCP endpoint to your app at `/_mcp` (configurable via
`basePath`).

## How it works

### Boot sequence

The MCP adapter hooks into the standard KickJS adapter lifecycle:

```text
bootstrap({ modules, adapters: [McpAdapter(...)] })
  |
  +-- 1. Register DI bindings
  |       @Service() TaskService -> Container
  |       @Controller() TaskController -> Container
  |
  +-- 2. Mount module routes on Express
  |       TaskModule.routes() -> /api/v1/tasks
  |       @Get('/'), @Post('/'), @Delete('/:id')
  |
  +-- 3. Adapter onRouteMount (per controller)
  |       McpAdapter collects { controller, mountPath }
  |
  +-- 4. Adapter beforeStart
  |       - Scan @McpTool decorators on collected controllers
  |       - Mount the MCP endpoint (Streamable HTTP; /_mcp/messages by default)
  |       - Each client gets its own session, or each request its own server with `stateless: true`
  |
  +-- 5. Error handlers registered
  |       app.use(notFoundHandler())
  |       app.use(errorHandler())
  |
  +-- 6. Server.listen(port)
  |
  +-- 7. Adapter afterStart (stdio transport only)
          - Connect the MCP server to stdin/stdout
```

The adapter mounts its routes in `beforeStart` (step 4) so they
land in the Express stack **before** the catch-all error handlers
(step 5). This ensures `/_mcp/messages` is reachable.

### Tool call dispatch

When an MCP client calls a tool, the adapter builds a request to the
tool's route and runs it through the **app's full pipeline** with
`AdapterContext.fetch` — your middleware, context decorators, auth
guards, validation, and request logging all apply. Tool calls are
indistinguishable from direct HTTP calls as far as your handler code is
concerned. No listening server is needed, so tools work under
`createHandler()` too, and the endpoint works on every runtime
(Express, Fastify, h3, h3 v2).

```text
MCP Client                    McpAdapter                   Express Pipeline
    |                              |                              |
    |  POST /_mcp/messages         |                              |
    |  Authorization: Bearer ...   |                              |
    |  { method: "tools/call",     |                              |
    |    params: {                  |                              |
    |      name: "...create",      |                              |
    |      arguments: {             |                              |
    |        title: "Ship it"      |                              |
    |  }}}                         |                              |
    | ---------------------------> |                              |
    |                              |                              |
    |                    SDK parses JSON-RPC                      |
    |                    callback(args, extra)                    |
    |                    extra.requestInfo.headers                |
    |                      .authorization                        |
    |                              |                              |
    |                         dispatchTool()                      |
    |                              |                              |
    |                              |  Build internal request:     |
    |                              |  POST /api/v1/tasks          |
    |                              |  Authorization: Bearer ...   |
    |                              |  Content-Type: application/json      |
    |                              |  Body: {"title":"Ship it"}   |
    |                              | ----------------------------> |
    |                              |                              |
    |                              |                 1. express.json()
    |                              |                 2. requestScope()
    |                              |                 3. Context Decorators
    |                              |                    @LoadUser reads
    |                              |                    Authorization header
    |                              |                    -> ctx.set('user', alice)
    |                              |                 4. Zod body validation
    |                              |                 5. Handler runs
    |                              |                    ctx.get('user') -> alice
    |                              |                    tasks.create(...)
    |                              |                    ctx.created({ task })
    |                              |                              |
    |                              |     HTTP 201 + JSON          |
    |                              | <--------------------------- |
    |                              |                              |
    |  { result: {                 |                              |
    |    content: [{               |                              |
    |      type: "text",           |                              |
    |      text: '{"task":...}'    |                              |
    |    }],                       |                              |
    |    isError: false            |                              |
    |  }}                          |                              |
    | <--------------------------- |                              |
```

Key points:

- Headers listed in `forwardHeaders` are copied from the MCP request
  onto the tool call — by default `authorization`, `cookie`,
  `x-request-id`, `traceparent` and `tracestate`. Add your own, such as
  a tenant header, by passing the full list.
- Cancelling the call in the MCP client aborts the request to the route.
- Path parameters (`:id`) are filled from tool arguments
- GET/DELETE routes send remaining args as query string; values arrive
  as strings, so number fields in a query schema need `z.coerce.number()`
- POST/PUT/PATCH routes send remaining args as JSON body

## Guides

| Page                                   | Covers                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [Tools](./mcp/tools.md)                | which routes become tools (`@McpTool`, route flags, `auto`), custom tool providers, annotations, structured results, typed errors, timeouts |
| [Authentication](./mcp/auth.md)        | the endpoint check, who is calling (`authenticate`), OAuth metadata and challenges, audiences, scopes, auth inside tool calls               |
| [Multi-Tenancy](./mcp/multi-tenant.md) | a server per tenant host, the tenant's host on tool calls, per-caller tool lists, `allowedHosts`, proxies                                   |
| [Deployment](./mcp/deployment.md)      | HTTP and stdio, the endpoint path, `stateless` for several instances, sessions, CORS                                                        |
| [Testing](./mcp/testing.md)            | `getTools()`, the SDK client, raw requests, the MCP Inspector                                                                               |
| [Security](./mcp/security.md)          | what protects a call, what stays yours, what's not supported yet                                                                            |
| [Reference](./mcp/reference.md)        | every option, field and type                                                                                                                |

## Sharing tools with `@forinda/kickjs-ai`

If your app already uses `@AiTool` for the in-process agent loop, you
don't need to duplicate metadata — both decorators can sit on the
same method:

```ts
@Post('/', { body: createTaskSchema })
@AiTool({
  name: 'create_task',
  description: 'Create a new task',
  inputSchema: createTaskSchema,
})
@McpTool({
  description: 'Create a new task',
})
async create(ctx: Ctx<KickRoutes.TaskController['create']>) {
  // one implementation, two transports
}
```

The in-process `AiAdapter` calls it via internal HTTP dispatch for
your own agents. The `McpAdapter` exposes the same method to external
MCP clients. Both paths flow through the normal request pipeline, so
middleware, auth, validation, and logging apply identically.

## Next steps

- [AI package](./ai) — in-process providers, an agent loop, memory and RAG, for your own agents
- [Authentication](./authentication) — the auth your routes run, which tool calls run too
- [Route Flags](./route-flags) — expose tools by flag instead of a decorator per method
