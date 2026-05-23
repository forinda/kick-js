# @forinda/kickjs-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server adapter — exposes `@Controller` endpoints as callable MCP tools for Claude Code, Claude Desktop, Cursor, Zed, and any other MCP-aware client. Zero duplicated schemas (the route's Zod `body` becomes the tool input shape automatically).

## Install

```bash
kick add mcp
```

## Quick Example

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
      mode: 'explicit', // opt-in via @McpTool decorator
      transport: 'http',
    }),
  ],
})
```

Mark which controller methods get exposed:

```ts
import { McpTool } from '@forinda/kickjs-mcp'

@Controller()
class TaskController {
  @Post('/', { body: createTaskSchema })
  @McpTool({ description: 'Create a task with title + priority' })
  create(ctx: RequestContext) { ... }

  @Get('/')
  @McpTool({ description: 'List all tasks. Read-only.' })
  list(ctx: RequestContext) { ... }
}
```

Then connect from Claude Code / Cursor / etc. via the standard MCP transport.

## How It Works

### Boot Sequence

```
bootstrap({ modules, adapters: [McpAdapter(...)] })
  |
  +-- 1. Register DI bindings (@Service, @Controller -> Container)
  +-- 2. Mount module routes on Express (/api/v1/tasks)
  +-- 3. McpAdapter.onRouteMount() — collects each controller + mount path
  +-- 4. McpAdapter.beforeStart() — scans @McpTool decorators, builds MCP
  |      server, mounts /_mcp/messages on Express
  +-- 5. Error handlers registered (notFoundHandler, errorHandler)
  +-- 6. Server.listen(port)
  +-- 7. McpAdapter.afterStart() — captures server base URL for dispatch
```

### Tool Call Dispatch Flow

When an MCP client calls a tool, the adapter dispatches it through the full Express pipeline via an internal HTTP request. Your existing middleware, context decorators, auth guards, validation, and logging all apply — identically to a direct HTTP call.

```
MCP Client                    McpAdapter                   Express Pipeline
    |                              |                              |
    |  POST /_mcp/messages         |                              |
    |  Authorization: Bearer ...   |                              |
    |  { method: "tools/call",     |                              |
    |    params: { name, args } }  |                              |
    | ---------------------------> |                              |
    |                              |                              |
    |                         dispatchTool()                      |
    |                              |                              |
    |                              |  Internal HTTP request:      |
    |                              |  POST /api/v1/tasks          |
    |                              |  Authorization: Bearer ...   |
    |                              |  Body: { "title": "..." }    |
    |                              | ----------------------------> |
    |                              |                              |
    |                              |                 1. express.json()
    |                              |                 2. requestScope()
    |                              |                 3. Context Decorators
    |                              |                    (@LoadUser -> ctx.set('user'))
    |                              |                 4. Zod validation
    |                              |                 5. Handler
    |                              |                    ctx.get('user') -> { alice }
    |                              |                    ctx.created({ task })
    |                              |                              |
    |                              |     HTTP 201 + JSON          |
    |                              | <--------------------------- |
    |                              |                              |
    |  { result: {                 |                              |
    |    content: [{ text: ... }], |                              |
    |    isError: false            |                              |
    |  }}                          |                              |
    | <--------------------------- |                              |
```

### Auth with Context Decorators

Context decorators (`defineHttpContextDecorator`) are the recommended way to flow authentication. They run on MCP-dispatched calls exactly the same way they run on direct HTTP — the `Authorization` header from the MCP client is forwarded into the internal request.

```ts
import { defineHttpContextDecorator } from '@forinda/kickjs'

const LoadUser = defineHttpContextDecorator({
  key: 'user',
  resolve: (ctx) => {
    const auth = ctx.req.headers.authorization
    if (!auth) return null
    return verifyJwt(auth.replace('Bearer ', ''))
  },
})

@Controller()
class TaskController {
  @LoadUser
  @Get('/')
  @McpTool({ description: 'List tasks for the authenticated user' })
  list(ctx: RequestContext) {
    const user = ctx.get('user')
    if (!user) throw new HttpException(401, 'Not authenticated')
    return ctx.json(await this.tasks.findByOwner(user.id))
  }
}
```

### What @McpTool Controls

```
@McpTool({ description: '...' })     ->  EXPOSED as tool
@McpTool({ hidden: true })           ->  NOT exposed (excluded even in auto mode)
No @McpTool decorator                ->  NOT exposed (in explicit mode, the default)
```

### Transport Modes

| Transport | When to use                                  | Auth mechanism                                     |
| --------- | -------------------------------------------- | -------------------------------------------------- |
| `http`    | Remote clients, web UIs, load balancers      | `Authorization` header on POST to `/_mcp/messages` |
| `stdio`   | Local CLI clients (Claude Code, Cursor, Zed) | Inherits parent process environment                |
| `sse`     | Legacy (aliases to HTTP internally)          | Same as HTTP                                       |

Both transports dispatch through the same Express pipeline — same middleware, same context decorators, same auth flow.

## Security

```
IN PLACE:
  [x] Explicit mode — only @McpTool-decorated routes exposed
  [x] Full Express pipeline — middleware, auth, RBAC, rate limits apply
  [x] Auth header forwarding — Authorization flows from MCP to internal dispatch
  [x] Zod input validation — SDK validates against route's body schema
  [x] getTools() — inspect the tool registry at runtime or in tests

NOT YET IN PLACE:
  [ ] Tool annotations (readOnlyHint, destructiveHint, idempotentHint)
  [ ] Elicitation (server-driven user prompts mid-call)
  [ ] Process sandbox (tools run in same Node process)
  [ ] Server-side approval / human-in-the-loop
```

The mental model: treat MCP exposure exactly like exposing the same route to a public HTTP client. Your existing auth + RBAC + rate-limit story carries the weight. The `@McpTool` decorator is the firewall — if you wouldn't put a route behind `@Public()`, don't decorate it with `@McpTool`.

## Documentation

[forinda.github.io/kick-js/guide/mcp](https://forinda.github.io/kick-js/guide/mcp) — full guide with transports, auto mode, dispatch internals, context decorator auth, and security notes.

## License

MIT
