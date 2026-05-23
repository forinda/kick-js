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
- **Database access** — expose Prisma/Drizzle queries as MCP tools so Claude can answer data questions
- **Onboarding** — new team members explore the API by talking to it instead of reading docs

**Auth just works.** If you already use context decorators (`@LoadUser`, `@LoadTenant`) or `@Roles('admin')` for your HTTP routes, they work on MCP calls identically. No separate auth layer for AI access.

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

Two ways to connect, depending on your setup:

#### Option A: stdio (local development)

The AI client **spawns your server itself** — no URL needed. The client and server talk over stdin/stdout pipes.

```bash
# Generate the config file
kick mcp init
```

This creates `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "task-api": {
      "command": "kick",
      "args": ["mcp"],
      "cwd": "/path/to/your-project"
    }
  }
}
```

Claude Code, Cursor, and Zed read this file automatically. When you open the project, they start your server as a background process and connect. You don't configure a URL — the client owns the process lifecycle.

For Claude Desktop, copy the entry to `~/.config/claude-desktop/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "task-api": {
      "command": "kick",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/your-project"
    }
  }
}
```

#### Option B: HTTP (remote / shared servers)

Your server is already running somewhere (localhost during dev, cloud URL in production). The MCP endpoint is at `/_mcp/messages` on whatever port your app uses:

```text
http://localhost:3000/_mcp/messages     # local dev
https://api.myapp.com/_mcp/messages     # production
```

Configure your AI client to connect via Streamable HTTP and point it at that URL. The port is your KickJS server's port — the same one that serves your REST API.

#### How does the client know the URL?

| Scenario             | How the client finds the server                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **stdio**            | Client reads `.mcp.json`, spawns `kick mcp` itself. No URL involved — communication is over stdin/stdout pipes.                                                    |
| **HTTP (local dev)** | Developer enters `http://localhost:<port>/_mcp/messages` in the client's MCP settings. The port is whatever `PORT` env var or `bootstrap({ port })` your app uses. |
| **HTTP (deployed)**  | Developer enters the deployed URL: `https://api.myapp.com/_mcp/messages`. Same endpoint, different host.                                                           |

For most local development, **stdio is the simplest** — `kick mcp init` and you're done. Use HTTP when the server runs on a different machine, in Docker, or behind a load balancer.

### 4. Verify with MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a browser UI for testing MCP servers. Use it to verify your setup before connecting a real AI client.

```bash
# Terminal 1 — your server
kick dev

# Terminal 2 — the inspector
npx @modelcontextprotocol/inspector
```

Then open `http://localhost:6274` in your browser:

1. Set **Transport Type** to `Streamable HTTP`
2. Set **URL** to `http://localhost:<your-port>/_mcp/messages`
3. Click **Connect** — you should see your server name and a green "Connected"
4. Click **List Tools** — your `@McpTool`-decorated endpoints appear with descriptions and input schemas
5. Click any tool, fill in the inputs, click **Run Tool**

To test with auth, expand **Authentication** in the sidebar, enable the `Authorization` header, and set its value (e.g. `Bearer <your-jwt>`).

See [the full guide](https://forinda.github.io/kick-js/guide/mcp#testing-with-mcp-inspector) for troubleshooting common issues (404, CORS, stale sessions).

## How It Works

### Boot Sequence

```text
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

### Tool Call Dispatch

When an MCP client calls a tool, the adapter dispatches it through the full Express pipeline via an internal HTTP request. Your existing middleware, context decorators, auth guards, validation, and logging all apply — identically to a direct HTTP call.

```text
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

### What @McpTool Controls

```text
@McpTool({ description: '...' })     ->  EXPOSED as tool
@McpTool({ hidden: true })           ->  NOT exposed (excluded even in auto mode)
No @McpTool decorator                ->  NOT exposed (in explicit mode, the default)
```

## Auth Guards with @Middleware

If you prefer standard Express middleware over context decorators, use `@Middleware()` with an auth guard. It works identically for MCP since tool calls dispatch through the full Express pipeline.

```ts
import { Controller, Get, Middleware, type RequestContext } from '@forinda/kickjs'
import { McpTool } from '@forinda/kickjs-mcp'

function authGuard(req, res, next) {
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ message: 'Not authenticated' })
  req.user = verifyJwt(auth.replace('Bearer ', ''))
  next()
}

@Controller()
class TaskController {
  @Middleware(authGuard)
  @Get('/')
  @McpTool({ description: 'List tasks' })
  list(ctx: RequestContext) {
    const user = (ctx.req as any).user
    return ctx.json(this.tasks.findByOwner(user.id))
  }
}
```

Context decorators are recommended (typed `ctx.get('user')`, DI support, topo-sorted `dependsOn`), but `@Middleware` works if you already have Express middleware you want to reuse. Both approaches forward the `Authorization` header from MCP clients.

## Authentication Patterns

MCP tool calls flow through the same Express pipeline as regular HTTP, so your existing auth works. The question is how the agent **gets** the token in the first place.

### Pattern 1: Static API key (simplest)

Issue API keys out-of-band. The user configures the key in their MCP client (`.mcp.json` env vars, Inspector sidebar, etc.). No login tool needed.

```ts
@LoadUser   // reads Authorization: Bearer <api-key>
@Get('/')
@McpTool({ description: 'List tasks' })
list(ctx: RequestContext) { ... }
```

Best for: internal tools, CI agents, single-user local dev.

### Pattern 2: Pre-obtained JWT

The user logs in via your web app or CLI, copies the JWT, and configures it in their MCP client. The login endpoint is a regular HTTP route — not an MCP tool.

```ts
// Regular HTTP — NOT decorated with @McpTool
@Post('/auth/login', { body: loginSchema })
login(ctx: RequestContext) {
  const user = await this.auth.verify(ctx.body)
  return ctx.json({ token: signJwt(user) })
}

// MCP tools use the pre-obtained token
@LoadUser
@Get('/tasks')
@McpTool({ description: 'List tasks' })
list(ctx: RequestContext) { ... }
```

Best for: production apps where users already log in via browser/mobile.

### Pattern 3: Session-based MCP login

Expose a login tool. Store the authenticated user in server-side session state keyed by the MCP session ID. Subsequent calls in the same session are automatically authenticated — the agent handles the full flow without pre-configured tokens.

```ts
const mcpSessions = new Map<string, User>()

@Controller()
class AuthController {
  @Post('/login', { body: loginSchema })
  @McpTool({ description: 'Log in with email and password. Call this first.' })
  async login(ctx: RequestContext) {
    const user = await this.auth.verify(ctx.body)
    const sessionId = ctx.req.headers['mcp-session-id'] as string
    if (sessionId) mcpSessions.set(sessionId, user)
    return ctx.json({ message: `Logged in as ${user.email}` })
  }
}
```

The context decorator checks the MCP session first, then falls back to the `Authorization` header:

```ts
const LoadUser = defineHttpContextDecorator({
  key: 'user',
  resolve: (ctx) => {
    // Check MCP session first
    const sid = ctx.req.headers['mcp-session-id'] as string
    if (sid && mcpSessions.has(sid)) return mcpSessions.get(sid)!

    // Fall back to Authorization header
    const auth = ctx.req.headers.authorization
    if (!auth) return null
    return verifyJwt(auth.replace('Bearer ', ''))
  },
})
```

The agent flow becomes:

```text
Agent: "Call login with { email, password }"
Server: stores user in MCP session -> "Logged in as alice"

Agent: "Call TaskController.create with { title: 'Ship it' }"
Server: @LoadUser finds alice via MCP session ID -> task created

No header management — the MCP session ID is sent
automatically by the SDK on every request.
```

Best for: agents that self-authenticate without pre-configured tokens.

### How auth flows through MCP

Regardless of which pattern you use, the flow is the same:

```text
MCP Client                          McpAdapter                    Express
    |                                    |                            |
    |  Authorization: Bearer <token>     |                            |
    |  (or MCP session carries auth)     |                            |
    |                                    |                            |
    |  POST /_mcp/messages               |                            |
    | ---------------------------------> |                            |
    |                                    |                            |
    |                          Extract auth from                      |
    |                          SDK extra.requestInfo                  |
    |                                    |                            |
    |                          Internal dispatch:                     |
    |                          POST /api/v1/tasks                     |
    |                          Authorization: Bearer <token>          |
    |                                    | -------------------------> |
    |                                    |                            |
    |                                    |           @LoadUser reads   |
    |                                    |           req.headers       |
    |                                    |           .authorization    |
    |                                    |           -> resolves user  |
    |                                    |                            |
    |                                    |           Same as direct    |
    |                                    |           HTTP call         |
    |                                    | <------------------------- |
```

### Which pattern to use

| Pattern                | When                                | Trade-off                                         |
| ---------------------- | ----------------------------------- | ------------------------------------------------- |
| **Static API key**     | Internal tools, CI, local dev       | Simplest; key provisioned out-of-band             |
| **Pre-obtained JWT**   | Users already log in via web/mobile | Works with existing auth; manual token copy       |
| **Session login tool** | Agents self-authenticate            | Most flexible; requires server-side session state |

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

## Transport Modes

```text
                 +-----------------------+
                 |      McpAdapter       |
                 |   transport: config   |
                 +-----------+-----------+
                             |
               +-------------+-------------+
               |                           |
               v                           v
     +------------------+       +------------------+
     |  stdio Transport  |       |  HTTP Transport   |
     |                  |       |                  |
     |  Client spawns   |       |  Server already  |
     |  your app via    |       |  running on a    |
     |  kick mcp start  |       |  known URL/port  |
     |                  |       |                  |
     |  No URL needed   |       |  /_mcp/messages  |
     |  stdin/stdout    |       |  on your port    |
     |  pipes           |       |                  |
     +------------------+       +------------------+
               |                           |
               +-------------+-------------+
                             |
                             v
                 Same Express pipeline
                 Same middleware
                 Same context decorators
                 Same auth flow
```

Both transports dispatch through the same Express pipeline.

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

## Troubleshooting

| Symptom                                                | Cause                                                  | Fix                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 404 on `/_mcp/messages`                                | Wrong URL or kickjs version before the mount-order fix | Use the full path `/_mcp/messages`; update `@forinda/kickjs` to latest patch                                                |
| "Server already initialized"                           | Stale MCP session from a previous connection           | Restart your KickJS server                                                                                                  |
| "Not Acceptable: Client must accept text/event-stream" | Opened `/_mcp/messages` in a browser tab               | Use the Inspector UI or a proper MCP client — the endpoint expects JSON-RPC POST requests                                   |
| CORS errors                                            | Browser client on a different origin                   | Add `cors({ origin: '*', exposedHeaders: ['mcp-session-id'] })` to middleware                                               |
| Tool calls return "Not authenticated"                  | Auth header not configured or not forwarded            | Configure `Authorization` in your MCP client; verify `@LoadUser` reads `ctx.req.headers.authorization`                      |
| Tools not showing up                                   | Methods not decorated with `@McpTool` in explicit mode | Add `@McpTool({ description: '...' })` to each method you want to expose                                                    |
| Inspector shows "proxy session token" error            | Inspector started with auth enabled                    | Open the full URL from Inspector output (includes `?MCP_PROXY_AUTH_TOKEN=...`) or restart with `DANGEROUSLY_OMIT_AUTH=true` |
| `@Autowired()` service is undefined (500 error)        | Running with `tsx`/`ts-node` — no decorator metadata   | Use `@Autowired(MyService)` with explicit token instead of bare `@Autowired()`                                              |
| "Mcp-Session-Id header is required"                    | CORS not exposing the session header                   | Add `exposedHeaders: ['mcp-session-id']` to your `cors()` config                                                            |

## Important Caveats

### One MCP session at a time

The MCP SDK's `StreamableHTTPServerTransport` allows **one active session per server**. The first client to `initialize` locks the session — any second client is rejected. This only affects `/_mcp/messages`; your regular API routes work normally with unlimited clients.

**Reset the session by:**

- **`kick dev`** — save any file to trigger HMR (resets the session)
- **Production** — restart the server
- **Inspector** — click Disconnect before closing the tab

**Rule of thumb:** don't `curl /_mcp/messages` before connecting the Inspector. Use one MCP client at a time.

### CORS for HTTP transport

Browser-based MCP clients (Inspector, web UIs) require CORS with the session header exposed:

```ts
middleware: [cors({ origin: '*', exposedHeaders: ['mcp-session-id'] }), express.json()]
```

Without `exposedHeaders`, the Inspector can't read the session ID and every request after `initialize` fails. Stdio transport doesn't need CORS.

### @Autowired needs explicit tokens with tsx

When running with `tsx`, `ts-node`, or any transpiler that strips decorator metadata:

```ts
// Fails with tsx — service is undefined at runtime:
@Autowired() private readonly svc!: MyService

// Works everywhere — always pass the token explicitly:
@Autowired(MyService) private readonly svc!: MyService
```

`kick dev` (Vite + SWC) emits metadata so bare `@Autowired()` works there, but the explicit form is safer as a default habit. This is especially visible with MCP — an uninjected service returns a generic 500 with no obvious cause.

## Documentation

[forinda.github.io/kick-js/guide/mcp](https://forinda.github.io/kick-js/guide/mcp) — full guide with transports, auto mode, dispatch internals, context decorator auth, Inspector setup, and security notes.

## License

MIT
