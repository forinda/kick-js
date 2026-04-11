# @forinda/kickjs-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server adapter for KickJS. Expose `@Controller` endpoints as callable MCP tools for Claude Code, Cursor, Zed, and other MCP-aware clients — with zero duplicated schemas.

## Status

**v0 — skeleton.** The decorator and adapter surface exist and compile against the framework. The tool-discovery scan and MCP SDK wiring are still TODOs inside the adapter's lifecycle hooks. This package is part of Workstream 1 of the v3 AI plan and will reach v1 when:

- [ ] Tool discovery scans every `@Controller` registered in the DI container
- [ ] Zod body schemas are converted to JSON Schema via the shared Swagger converter
- [ ] `stdio`, `sse`, and `http` transports are wired to `@modelcontextprotocol/sdk`
- [ ] The `kick mcp` CLI command starts a standalone MCP server
- [ ] Integration test: start a KickJS app, connect an MCP client, call a tool
- [ ] Example app in `examples/mcp-server-api/`

## Install

```bash
pnpm add @forinda/kickjs-mcp @modelcontextprotocol/sdk
```

## Usage (planned)

```ts
import { bootstrap } from '@forinda/kickjs'
import { McpAdapter } from '@forinda/kickjs-mcp'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    new McpAdapter({
      name: 'task-api',
      version: '1.0.0',
      description: 'Task management MCP server',
      mode: 'explicit', // only @McpTool-decorated methods
      transport: 'sse',
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
    description: 'Create a new task with title, priority, and optional assignee',
    examples: [
      { args: { title: 'Ship v3', priority: 'high' } },
    ],
  })
  create(ctx: Ctx<KickRoutes.TaskController['create']>) {
    return this.createTaskUseCase.execute(ctx.body)
  }
}
```

The input schema of each tool is derived automatically from the route's Zod `body` schema. Add a field, and both OpenAPI (via the Swagger adapter) and MCP pick it up on the next restart — no duplicated type declarations.

## Exposure modes

| Mode | Behavior |
|------|----------|
| `explicit` (default) | Only methods decorated with `@McpTool` are exposed. |
| `auto` | Every route is exposed, subject to `include` / `exclude` filters. |

Use `explicit` in production unless you've carefully reviewed every route. `auto` is convenient during development but can leak admin or internal endpoints if you forget to filter them out.

## Transports

| Transport | Use case |
|-----------|----------|
| `stdio` | CLI MCP clients (Claude Code, Cursor). Run via `kick mcp` in a separate process. |
| `sse` | Mounted on the existing Express app. Default for long-running servers. |
| `http` | Simpler than SSE; gives up live notifications. |

## License

MIT
