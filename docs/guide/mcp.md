# MCP (Model Context Protocol)

`@forinda/kickjs-mcp` exposes a KickJS application as an
[MCP](https://modelcontextprotocol.io/) server. Once installed, any
LLM client that speaks MCP — Claude Desktop, Claude Code, Cursor,
Zed, and others — can discover your controllers as callable tools,
read their Zod schemas, and invoke them safely through the normal
Express pipeline.

The adapter was built on the same `onRouteMount` → `beforeStart` →
`afterStart` lifecycle as every other adapter, so plugging it into an
existing app is three lines of configuration.

## Install

```bash
pnpm add @forinda/kickjs-mcp
```

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
an MCP server to your Express pipeline at `/_mcp` (configurable via
`basePath`).

## Exposure modes

`mode` decides which routes become MCP tools:

- **`explicit`** (default) — only methods decorated with `@McpTool`
  are exposed. This is the safe default: new controllers don't
  suddenly become model-accessible without you saying so.
- **`auto`** — every route that matches `include` and `exclude` is
  exposed automatically. Useful for internal/admin apps where every
  endpoint is intentionally callable by the model.

```ts
// Auto mode — expose every GET/POST route except admin paths
McpAdapter({
  name: 'internal-api',
  mode: 'auto',
  include: ['GET', 'POST'],
  exclude: ['/admin/*', '/internal/debug/*'],
})
```

## Marking routes with `@McpTool`

The decorator adds MCP-specific metadata (description, examples) on
top of an existing route decorator. The route's Zod `body` schema is
converted to JSON Schema automatically and used as the tool's input
shape — you don't maintain two schemas.

```ts
import { z } from 'zod'
import { Controller, Post, type Ctx } from '@forinda/kickjs'
import { McpTool } from '@forinda/kickjs-mcp'

const createTaskSchema = z.object({
  title: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high']).optional(),
})

@Controller('/tasks')
export class TaskController {
  @Post('/', { body: createTaskSchema, name: 'CreateTask' })
  @McpTool({
    description: 'Create a new task in the backlog',
    examples: [
      {
        description: 'Create a high-priority ship task',
        args: { title: 'Ship v3', priority: 'high' },
      },
    ],
  })
  async create(ctx: Ctx<KickRoutes.TaskController['create']>) {
    return ctx.created(await this.service.create(ctx.body))
  }
}
```

- The `@Post` decorator's `body` schema is what the MCP client sees
  as the tool's input.
- `examples` show up in client UIs (and some clients use them for
  few-shot guidance). Keep them small and representative.
- Tool names default to the route's `name` option, falling back to
  `ControllerName.methodName`.

## Transports

MCP supports three transports; pick the one that matches your
deployment:

| Transport | When to use                                                           |
| --------- | --------------------------------------------------------------------- |
| `stdio`   | CLI clients (Claude Desktop, Claude Code, Cursor) running locally     |
| `http`    | Remote clients, web UIs, anything behind a load balancer              |
| `sse`     | Legacy long-lived SSE connections (still supported by some clients)   |

### Stdio (local clients)

Use the CLI to run a KickJS app as an MCP stdio server:

```bash
kick mcp start
```

This boots the app in a special mode where Express sits idle and the
MCP server owns stdin/stdout. Register it in your client's MCP
config:

```jsonc
// ~/.config/claude-desktop/claude_desktop_config.json
{
  "mcpServers": {
    "task-api": {
      "command": "kick",
      "args": ["mcp", "start"],
      "cwd": "/absolute/path/to/your-app"
    }
  }
}
```

Or scaffold the config directly:

```bash
kick mcp init   # writes .mcp.json
```

### HTTP (remote clients)

The default `basePath` is `/_mcp`. Once the app is running:

```
https://your-app.example.com/_mcp
```

Add it to your client's MCP config as an HTTP server. Pair with
`auth` to require a bearer token or API key:

```ts
McpAdapter({
  name: 'task-api',
  transport: 'http',
  auth: {
    strategy: 'bearer',
    token: getEnv('MCP_BEARER_TOKEN'),
  },
})
```

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
MCP clients. Both paths flow through the normal Express pipeline, so
middleware, auth, validation, and logging apply identically.

## Debugging

The adapter exposes the discovered tool registry for tests and
admin UIs:

```ts
const mcp = container.resolve(McpAdapter)
console.log(mcp.getTools())
// → [{ name: 'CreateTask', description: '...', inputSchema: {...} }, ...]
```

For HTTP/SSE transports, hit the server's `GET /_mcp` in a browser to
see a minimal status page with the exposed tools and their schemas.

For stdio, log to `stderr` — never `stdout` — because the MCP client
reads responses from `stdout` and any stray write will corrupt the
stream. The framework's `Logger` already writes to `stderr` by
default, so you don't need to change anything.

## Security notes

- Never expose mutation routes in `auto` mode on a public-facing app
  without an explicit allowlist. Start with `mode: 'explicit'`.
- Pair HTTP transports with `auth` — MCP clients always support
  bearer tokens, and the adapter's auth hook plugs into the same
  `@forinda/kickjs-auth` strategies you already use.
- MCP tools run with the same permissions as any other controller
  route. Guards, role checks, and rate limits still apply.
- The tool descriptions and examples are shown verbatim in client
  UIs. Don't embed secrets in them.

## Next steps

- [AI package](./ai) — in-process provider, memory, and RAG that
  complements MCP for your own agent workflows
- [Authentication](./authentication) — strategies you can attach to
  MCP HTTP transports
- [Plugins](./plugins) — the canonical place to wire the adapter's
  dependencies
