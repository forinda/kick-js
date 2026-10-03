# @forinda/kickjs-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for KickJS. It exposes your controller routes as tools for Claude, Claude Code, Cursor and other MCP clients. Each call runs through the route's own middleware, auth and validation, and its schemas become the tool's input. Resources, asking the user mid-call, OAuth and per-caller tool lists are built in. It serves protocol 2026-07-28 and the 2025 revisions.

## Install

```bash
kick add mcp       # or: pnpm add @forinda/kickjs-mcp @modelcontextprotocol/server
```

## Quick example

```ts
import { Controller, Post, bootstrap, type RequestContext } from '@forinda/kickjs'
import { McpAdapter, McpTool } from '@forinda/kickjs-mcp'

@Controller()
export class TaskController {
  @Post('/', { body: createTaskSchema })
  @McpTool({ description: 'Create a task with a title and priority' })
  create(ctx: RequestContext) {
    return this.tasks.create(ctx.body)
  }
}

export const app = await bootstrap({
  modules,
  adapters: [McpAdapter({ name: 'task-api', path: '/mcp' })],
})
```

Point a client at `http://localhost:3000/mcp`, or run `kick mcp start` for stdio. Only routes marked `@McpTool` (or a route flag) are exposed.

## Documentation

[kickjs.app/guide/mcp](https://kickjs.app/guide/mcp): tools, resources, authentication and OAuth, multi-tenancy, deployment, testing, security, and the full option reference.

## License

MIT
