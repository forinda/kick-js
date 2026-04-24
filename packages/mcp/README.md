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
  @Post('/')
  @McpTool({ description: 'Create a task with title + priority' })
  create(ctx: RequestContext) { ... }
}
```

Then connect from Claude Code / Cursor / etc. via the standard MCP transport.

## Documentation

[forinda.github.io/kick-js/guide/mcp](https://forinda.github.io/kick-js/guide/mcp) — `kick mcp` CLI, transports (stdio/http/sse), `auto` mode + filters, dispatch internals.

## License

MIT
