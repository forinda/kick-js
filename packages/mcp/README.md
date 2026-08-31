# @forinda/kickjs-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server adapter — exposes `@Controller` endpoints as callable MCP tools for Claude Code, Claude Desktop, Cursor, Zed, and any other MCP-aware client. Zero duplicated schemas (the route's Zod `body` becomes the tool input shape automatically).

## Why MCP?

You already have a REST API. MCP lets AI tools call your endpoints as native tools — no glue code, no client SDKs, no OpenAPI wrappers.

**Your API becomes AI-native in one decorator:**

```ts
@Post('/', { body: createTaskSchema })
@McpTool({ description: 'Create a task with title and priority' })
create(ctx: RequestContext) { ... }
```

Now a developer in Claude Code or Cursor can say _"create a task called Fix login bug with high priority"_ — and the LLM calls your endpoint directly. No curl, no Postman, no Swagger UI. They stay in their editor.

**What people use this for:**

- **Internal tools** — ops team queries and mutates data through an AI assistant instead of building admin UIs
- **Dev workflows** — _"list all users who signed up this week"_ against a running staging server
- **CI/CD agents** — AI agents that create issues, update statuses, or trigger deploys via your API
- **Database access** — expose your query layer as MCP tools so Claude can answer data questions
- **Onboarding** — new team members explore the API by talking to it instead of reading docs

**Auth just works.** If you already resolve the user and check roles with context decorators (`@LoadUser`, `@RequireRole`) on your HTTP routes, they work on MCP calls identically. No separate auth layer for AI access.

**You control what's exposed.** `mode: 'explicit'` (the default) means nothing is visible to AI unless you put `@McpTool` on it. Admin endpoints, dangerous mutations, internal debug routes — none of them leak.

## Install

```bash
kick add mcp
```

## Quick Start

### 1. Wire the adapter into bootstrap

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
      mode: 'explicit',
      transport: 'http',
    }),
  ],
})
```

### 2. Mark which methods to expose

```ts
import { Controller, Get, Post, Delete, type RequestContext } from '@forinda/kickjs'
import { McpTool } from '@forinda/kickjs-mcp'

@Controller()
class TaskController {
  @Get('/')
  @McpTool({ description: 'List all tasks. Read-only.' })
  list(ctx: RequestContext) { ... }

  @Post('/', { body: createTaskSchema })
  @McpTool({ description: 'Create a task with title and priority' })
  create(ctx: RequestContext) { ... }

  @Delete('/:id')
  @McpTool({ description: 'Delete a task by id. Destructive.' })
  delete(ctx: RequestContext) { ... }

  @Get('/internal-report')
  report(ctx: RequestContext) { ... }  // NOT exposed — no @McpTool
}
```

### 3. Connect your AI client

`kick mcp init` writes a `.mcp.json` that Claude Code, Cursor and Zed read
automatically — they spawn the server over stdio and own its lifecycle:

```bash
kick mcp init
```

For a server already running over HTTP, point the client at
`/_mcp/messages` instead. Both transports, the Claude Desktop config path,
and verifying with MCP Inspector are covered in
[the guide](https://kickjs.app/guide/mcp).

## Exposure Modes

`mode` decides which routes become MCP tools:

- **`explicit`** (default) — only methods decorated with `@McpTool` are exposed. New controllers don't suddenly become model-accessible.
- **`auto`** — every route matching `include`/`exclude` is exposed automatically. Useful for internal apps where every endpoint is intentionally callable.

```ts
McpAdapter({
  name: 'internal-api',
  mode: 'auto',
  include: ['GET', 'POST'],
  exclude: ['/admin/*', '/internal/debug/*'],
})
```

## McpAdapter Options

```ts
McpAdapter({
  name: 'my-api', // MCP server name (shown in client UIs)
  version: '1.0.0', // Server version (shown in client UIs)
  description: 'My API server', // Human-readable description
  mode: 'explicit', // 'explicit' (default) | 'auto'
  transport: 'http', // 'http' (default) | 'stdio' | 'sse'
  basePath: '/_mcp', // HTTP mount path (default: '/_mcp')
  include: ['GET', 'POST'], // Auto mode: which HTTP methods to expose
  exclude: ['/admin/*'], // Auto mode: path prefixes to skip
  auth: {
    // Transport-level auth (HTTP/SSE only)
    type: 'bearer',
    validate: (token) => isValid(token),
  },
})
```

## @McpTool Options

```ts
@McpTool({
  description: 'Create a task',          // Required. Shown to the LLM.
  name: 'create_task',                   // Override tool name (default: Controller.method)
  inputSchema: z.object({ ... }),        // Override input schema (default: route's body schema)
  outputSchema: z.object({ ... }),       // Output schema for documentation
  hidden: true,                          // Exclude from auto mode
  examples: [{                           // Usage examples shown in client UIs
    description: 'Create a high-priority task',
    args: { title: 'Ship v3', priority: 'high' },
    result: { id: '1', title: 'Ship v3' },
  }],
})
```

## Security

```text
IN PLACE:
  [x] Explicit mode — only @McpTool-decorated routes exposed
  [x] Full HTTP pipeline — middleware, auth, RBAC, rate limits apply
  [x] Auth header forwarding — Authorization flows from MCP to internal dispatch
  [x] Zod input validation — SDK validates against route's body schema
  [x] getTools() — inspect the tool registry at runtime or in tests

NOT YET IN PLACE:
  [ ] Tool annotations (readOnlyHint, destructiveHint, idempotentHint)
  [ ] Elicitation (server-driven user prompts mid-call)
  [ ] Process sandbox (tools run in same Node process)
  [ ] Server-side approval / human-in-the-loop
```

The mental model: treat MCP exposure exactly like exposing the same route to a public HTTP client. Your existing auth + RBAC + rate-limit story carries the weight.

In the default `explicit` mode, `@McpTool` is the gate — if you would not expose a route to an unauthenticated client, do not decorate it. **`mode: 'auto'` removes that gate**: every route matching `include` / `exclude` becomes a tool whether or not it carries the decorator, so the filters and the route's own authorization are the only things standing between a model and the endpoint. Use `@McpTool({ hidden: true })` to opt a route out, and do not rely on the absence of a decorator to keep anything private.

## Documentation

[kickjs.app/guide/mcp](https://kickjs.app/guide/mcp) — full guide with transports, auto mode, dispatch internals, context decorator auth, Inspector setup, and security notes.

## License

MIT
