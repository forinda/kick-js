# @forinda/kickjs-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server adapter for KickJS. Expose `@Controller` endpoints as callable MCP tools for Claude Code, Claude Desktop, Cursor, Zed, and any other MCP-aware client — with zero duplicated schemas.

## Features

- **Automatic tool discovery** — walks every registered controller at startup, reads route metadata, and builds the tool registry without any manual wiring.
- **Zero schema duplication** — the route's Zod `body` schema is converted to JSON Schema automatically and used as the tool's input shape.
- **Three transports** — `stdio` for local CLI clients, `http` for remote clients behind a load balancer, and `sse` for legacy long-lived connections.
- **`explicit` and `auto` exposure modes** — either opt-in via `@McpTool` or expose every route subject to `include`/`exclude` filters.
- **Internal HTTP dispatch** — tool invocations flow through the normal Express pipeline, so middleware, auth guards, validation, and logging apply identically to external callers. Auth tokens from the MCP transport request are forwarded automatically.
- **`kick mcp` CLI** — `kick mcp start` runs your app in stdio mode; `kick mcp init` scaffolds a `.mcp.json` config for client registration.

## Install

```bash
pnpm add @forinda/kickjs-mcp
```

`@modelcontextprotocol/sdk` is bundled as a dependency — nothing else to install.

## Usage

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

Mark controller methods with `@McpTool` to expose them:

```ts
import { Controller, Post, type Ctx } from '@forinda/kickjs'
import { McpTool } from '@forinda/kickjs-mcp'
import { createTaskSchema } from './dtos/create-task.dto'

@Controller('/tasks')
export class TaskController {
  @Post('/', { body: createTaskSchema, name: 'CreateTask' })
  @McpTool({
    description: 'Create a new task with title and priority',
    examples: [{ args: { title: 'Ship v3', priority: 'high' } }],
  })
  create(ctx: Ctx<KickRoutes.TaskController['create']>) {
    return this.createTaskUseCase.execute(ctx.body)
  }
}
```

Add a field to `createTaskSchema` and both OpenAPI (via the Swagger adapter) and MCP pick it up on the next restart.

## Exposure modes

| Mode                 | Behavior                                                              |
| -------------------- | --------------------------------------------------------------------- |
| `explicit` (default) | Only methods decorated with `@McpTool` are exposed.                   |
| `auto`               | Every route is exposed, subject to `include` / `exclude` filters.     |

Stay on `explicit` for public-facing apps unless every route has been reviewed. `auto` is convenient for internal tools and dev environments where you control the caller.

## Transports

| Transport | When to use                                                           |
| --------- | --------------------------------------------------------------------- |
| `stdio`   | Local CLI clients (Claude Desktop, Claude Code, Cursor) — run via `kick mcp start` |
| `http`    | Remote clients, web UIs, anything behind a load balancer. Default basePath: `/_mcp` |
| `sse`     | Legacy long-lived SSE connections (still supported by some clients)   |

### Stdio with Claude Desktop

```bash
kick mcp init   # writes .mcp.json
```

Register the server in your client's config:

```jsonc
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

## Sharing tools with `@forinda/kickjs-ai`

Stack both decorators on the same method and one implementation serves two transports — the in-process agent loop (`AiAdapter.runAgent`) and the external MCP client:

```ts
@Post('/', { body: createTaskSchema })
@AiTool({ name: 'create_task', description: 'Create a new task', inputSchema: createTaskSchema })
@McpTool({ description: 'Create a new task' })
async create(ctx: Ctx<KickRoutes.TaskController['create']>) {
  return this.createTaskUseCase.execute(ctx.body)
}
```

## Documentation

Full usage guide: [kickjs.dev/guide/mcp](https://forinda.github.io/kick-js/guide/mcp)

Related: [`@forinda/kickjs-ai`](../ai) is the in-process companion — providers, memory, RAG, and the agent loop that uses the same `@AiTool` / `@McpTool` methods for your own workflows.

## License

MIT
