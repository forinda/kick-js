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
  |       - Build MCP server (registerTool for each)
  |       - Mount /_mcp/messages on Express (StreamableHTTP transport)
  |
  +-- 5. Error handlers registered
  |       app.use(notFoundHandler())
  |       app.use(errorHandler())
  |
  +-- 6. Server.listen(port)
  |
  +-- 7. Adapter afterStart
          - Capture serverBaseUrl for internal dispatch
```

The adapter mounts its routes in `beforeStart` (step 4) so they
land in the Express stack **before** the catch-all error handlers
(step 5). This ensures `/_mcp/messages` is reachable.

### Tool call dispatch

When an MCP client calls a tool, the adapter builds an internal
HTTP request that flows through the **full Express pipeline** — your
middleware, context decorators, auth guards, Zod validation, and
request logging all apply. Tool calls are indistinguishable from
direct HTTP calls as far as your handler code is concerned.

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

- The `Authorization` header from the MCP POST is extracted from the
  SDK's `extra.requestInfo.headers` and forwarded into the internal
  fetch
- Path parameters (`:id`) are substituted from tool arguments
- GET/DELETE routes send remaining args as query string
- POST/PUT/PATCH routes send remaining args as JSON body

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

### What @McpTool controls

```text
@McpTool({ description: '...' })     ->  EXPOSED as tool
@McpTool({ hidden: true })           ->  NOT exposed (excluded even in auto mode)
No @McpTool decorator                ->  NOT exposed (in explicit mode)
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

@Controller()
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

## Auth with context decorators

Context decorators (`defineHttpContextDecorator`) are the recommended
way to flow authentication into MCP tool calls. They run on
MCP-dispatched calls exactly the same way they run on direct HTTP —
the `Authorization` header from the MCP client is forwarded into the
internal request automatically.

```ts
import {
  defineHttpContextDecorator,
  Controller,
  Get,
  Post,
  HttpException,
  type RequestContext,
} from '@forinda/kickjs'
import { McpTool } from '@forinda/kickjs-mcp'

// 1. Define the context decorator
const LoadUser = defineHttpContextDecorator({
  key: 'user',
  resolve: (ctx) => {
    const auth = ctx.req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) return null
    return verifyJwt(auth.replace('Bearer ', ''))
  },
})

// 2. Apply it to your controller methods (or at the class level)
@Controller()
class TaskController {
  @LoadUser
  @Get('/')
  @McpTool({ description: 'List tasks for the authenticated user' })
  list(ctx: RequestContext) {
    const user = ctx.get('user')
    if (!user) throw new HttpException(401, 'Not authenticated')
    return ctx.json(this.tasks.findByOwner(user.id))
  }

  @LoadUser
  @Post('/', { body: createTaskSchema })
  @McpTool({ description: 'Create a task for the authenticated user' })
  create(ctx: RequestContext) {
    const user = ctx.get('user')
    if (!user) throw new HttpException(401, 'Not authenticated')
    return ctx.created(this.tasks.create(user.id, ctx.body.title))
  }
}
```

### How auth flows through MCP

```text
MCP Client                          Internal Dispatch              @LoadUser
    |                                       |                          |
    |  Authorization: Bearer <jwt>          |                          |
    |  (on POST to /_mcp/messages)          |                          |
    | ------------------------------------> |                          |
    |                                       |                          |
    |                  McpAdapter extracts   |                          |
    |                  auth from SDK extra   |                          |
    |                  and forwards it:      |                          |
    |                                       |                          |
    |                  POST /api/v1/tasks    |                          |
    |                  Authorization: Bearer |                          |
    |                  <same jwt>            |                          |
    |                                       | -----------------------> |
    |                                       |                          |
    |                                       |    ctx.req.headers       |
    |                                       |      .authorization      |
    |                                       |    = "Bearer <jwt>"      |
    |                                       |                          |
    |                                       |    verifyJwt(token)      |
    |                                       |    -> { id, email, ... } |
    |                                       |                          |
    |                                       |    ctx.set('user', user) |
    |                                       | <----------------------- |
    |                                       |                          |
    |                                  Handler:                        |
    |                                  ctx.get('user')                 |
    |                                  -> { id, email, ... }           |
```

No special wiring needed — the same `@LoadUser` decorator works for
both direct HTTP and MCP-dispatched calls. If you already have auth
working for your API, it works for MCP automatically.

## Auth with @Middleware (alternative)

If you prefer not to use context decorators, you can use the standard
`@Middleware()` decorator with a regular Express auth guard. This
works identically for MCP since tool calls dispatch through the full
Express pipeline.

```ts
import {
  Controller,
  Get,
  Post,
  Middleware,
  HttpException,
  type RequestContext,
} from '@forinda/kickjs'
import { McpTool } from '@forinda/kickjs-mcp'
import type { Request, Response, NextFunction } from 'express'

// Express middleware that verifies the token and attaches the user to req
function authGuard(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authenticated' })
  }
  try {
    ;(req as any).user = verifyJwt(auth.replace('Bearer ', ''))
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid token' })
  }
}

@Controller()
class TaskController {
  @Middleware(authGuard)
  @Get('/')
  @McpTool({ description: 'List tasks for the authenticated user' })
  list(ctx: RequestContext) {
    const user = (ctx.req as any).user
    return ctx.json(this.tasks.findByOwner(user.id))
  }

  @Middleware(authGuard)
  @Post('/', { body: createTaskSchema })
  @McpTool({ description: 'Create a task' })
  create(ctx: RequestContext) {
    const user = (ctx.req as any).user
    return ctx.created(this.tasks.create(user.id, ctx.body.title))
  }
}
```

### Context decorators vs @Middleware for auth

|                    | Context decorators                                                                    | @Middleware                                                      |
| ------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **How it works**   | `resolve()` runs in the contributor pipeline, result goes into `ctx.set('user', ...)` | Standard Express middleware, attaches to `req.user`              |
| **Typed access**   | `ctx.get('user')` is typed via `ContextMeta` augmentation                             | `(req as any).user` — requires manual cast                       |
| **Scope**          | Can apply at method, class, module, adapter, or global level                          | Must apply per-method or per-class with `@Middleware()`          |
| **DI support**     | `deps: { repo: REPO_TOKEN }` resolves DI tokens in the resolver                       | No built-in DI — must import services directly                   |
| **Ordering**       | Topo-sorted via `dependsOn` — `@LoadProject` can depend on `@LoadTenant`              | Runs in decoration order only                                    |
| **Recommendation** | Preferred for MCP — designed for this use case                                        | Fine if you already have Express middleware and want to reuse it |

Both approaches work with MCP. The `Authorization` header flows
through either way. Context decorators are the recommended path
because they're typed, composable, and support DI — but if you
already have Express auth middleware, `@Middleware(authGuard)` works
without any changes.

## Authentication patterns

MCP tool calls flow through the same Express pipeline as regular
HTTP, so your existing auth works. The question is how the agent
**gets** the token in the first place. Three patterns, from simplest
to most powerful:

### Pattern 1: Static API key

Issue API keys out-of-band. The user configures the key in their MCP
client (`.mcp.json` env vars, Inspector sidebar, etc.). No login tool
needed.

```ts
@LoadUser   // reads Authorization: Bearer <api-key>
@Get('/')
@McpTool({ description: 'List tasks' })
list(ctx: RequestContext) { ... }
```

Best for: internal tools, CI agents, single-user local dev.

### Pattern 2: Pre-obtained JWT

The user logs in via your web app or CLI, copies the JWT, and
configures it in their MCP client. The login endpoint is a regular
HTTP route — **not** an MCP tool.

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

Best for: production apps where users already log in via
browser/mobile.

### Pattern 3: Session-based MCP login

Expose a login tool. Store the authenticated user in server-side
session state keyed by the MCP session ID. Subsequent calls in the
same session are automatically authenticated — the agent handles the
full flow without pre-configured tokens.

```ts
const mcpSessions = new Map<string, User>()

@Controller()
class AuthController {
  @Post('/login', { body: loginSchema })
  @McpTool({
    description: 'Log in with email and password. Call this before other tools.',
  })
  async login(ctx: RequestContext) {
    const user = await this.auth.verify(ctx.body)

    // Store user keyed by MCP session ID
    const sessionId = ctx.req.headers['mcp-session-id'] as string
    if (sessionId) mcpSessions.set(sessionId, user)

    return ctx.json({ message: `Logged in as ${user.email}` })
  }
}
```

The context decorator checks the MCP session first, then falls back
to the `Authorization` header for regular HTTP:

```ts
const LoadUser = defineHttpContextDecorator({
  key: 'user',
  resolve: (ctx) => {
    // Check MCP session first
    const sid = ctx.req.headers['mcp-session-id'] as string
    if (sid && mcpSessions.has(sid)) return mcpSessions.get(sid)!

    // Fall back to Authorization header (regular HTTP, API keys)
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

Best for: agents that self-authenticate without pre-configured
tokens.

### Which pattern to use

| Pattern              | When                                | Trade-off                                         |
| -------------------- | ----------------------------------- | ------------------------------------------------- |
| **Static API key**   | Internal tools, CI, local dev       | Simplest; key provisioned out-of-band             |
| **Pre-obtained JWT** | Users already log in via web/mobile | Works with existing auth; manual token copy       |
| **Session login**    | Agents self-authenticate            | Most flexible; requires server-side session state |

## Transports

MCP supports three transports; pick the one that matches your
deployment:

| Transport | When to use                                  | Auth mechanism                 |
| --------- | -------------------------------------------- | ------------------------------ |
| `http`    | Remote clients, web UIs, load balancers      | `Authorization` header on POST |
| `stdio`   | Local CLI clients (Claude Code, Cursor, Zed) | Inherits parent process env    |
| `sse`     | Legacy (aliases to HTTP internally)          | Same as HTTP                   |

Both transports dispatch through the same Express pipeline — same
middleware, same context decorators, same auth flow.

```text
                 +--------------------+
                 |   McpAdapter       |
                 |   transport config |
                 +--------+---------+
                          |
            +-------------+-------------+
            |                           |
            v                           v
  +------------------+       +------------------+
  |  HTTP Transport   |       |  stdio Transport  |
  |                  |       |                  |
  |  Mounts on       |       |  stdin/stdout    |
  |  Express at      |       |  (JSON-RPC wire) |
  |  /_mcp/messages  |       |                  |
  |                  |       |  kick mcp start  |
  |  Auth via        |       |  sets            |
  |  Authorization   |       |  KICK_MCP_STDIO=1|
  |  header          |       |                  |
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
      "cwd": "/absolute/path/to/your-app",
    },
  },
}
```

Or scaffold the config directly:

```bash
kick mcp init   # writes .mcp.json
```

### HTTP (remote clients)

The default `basePath` is `/_mcp`. Once the app is running:

```
https://your-app.example.com/_mcp/messages
```

Add it to your client's MCP config as an HTTP server.

## Testing with MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
is a browser-based UI for connecting to any MCP server, discovering
tools, and calling them interactively. It's the fastest way to verify
your MCP setup is working before connecting a real AI client.

### 1. Start your KickJS server

```bash
kick dev
# or
node dist/index.js
```

Note the port your server starts on (e.g. `3000`, `3399`).

### 2. Start the Inspector

In a **separate terminal**:

```bash
npx @modelcontextprotocol/inspector
```

The Inspector starts two processes:

- **UI** on `http://localhost:6274` — open this in your browser
- **Proxy** on `http://localhost:6277` — the UI talks to your
  server through this proxy

### 3. Connect to your server

In the Inspector UI:

1. Set **Transport Type** to `Streamable HTTP`
2. Set **URL** to your server's MCP endpoint:
   ```text
   http://localhost:<your-port>/_mcp/messages
   ```
   The `/_mcp/messages` path is where `McpAdapter` mounts the
   StreamableHTTP transport. Replace `<your-port>` with whatever
   port your KickJS server is running on.
3. Click **Connect**

You should see a green **Connected** indicator and your server name

- version in the sidebar.

### 4. Discover and call tools

1. Click **List Tools** — your `@McpTool`-decorated endpoints appear
   with their descriptions and input schemas
2. Click any tool to see its input form (fields come from your Zod
   body schema)
3. Fill in the fields and click **Run Tool** to invoke it

The tool result shows the JSON response from your handler, along
with whether the call succeeded or errored.

### 5. Testing with authentication

If your tools require authentication (via context decorators like
`@LoadUser`), you need to send an `Authorization` header:

1. Expand the **Authentication** section in the sidebar
2. Under **Custom Headers**, toggle the `Authorization` switch on
3. Set the header value to your token (e.g. `Bearer <your-jwt>`)
4. Click **Connect** (or **Reconnect** if already connected)

The Inspector sends the header on every request. Your context
decorator reads `ctx.req.headers.authorization` from the internal
dispatch and resolves the user as normal.

### Common issues

| Symptom                                                | Cause                                                      | Fix                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 404 on connect                                         | Wrong URL — missing `/_mcp/messages`                       | Use the full path: `http://localhost:<port>/_mcp/messages`                                                                           |
| "Server already initialized"                           | Stale session from a previous connection                   | Restart your KickJS server to reset the MCP session                                                                                  |
| "Not Acceptable: Client must accept text/event-stream" | Opened `/_mcp/messages` directly in a browser tab          | Use the Inspector UI, not a direct browser navigation — the endpoint expects JSON-RPC POST requests                                  |
| CORS errors in browser console                         | Connecting from a different origin without CORS configured | Add `cors()` middleware in your bootstrap: `middleware: [cors({ origin: '*', exposedHeaders: ['mcp-session-id'] }), express.json()]` |
| Tool calls return "Not authenticated"                  | Auth header not configured in the Inspector                | Expand Authentication, enable the Authorization header, set the value                                                                |

### Programmatic inspection

The adapter also exposes the tool registry in code for tests and
admin UIs:

```ts
const mcp = container.resolve(McpAdapter)
console.log(mcp.getTools())
// -> [{ name: 'CreateTask', description: '...', inputSchema: {...} }, ...]
```

### Stdio debugging

For stdio transport, log to `stderr` — never `stdout` — because the
MCP client reads responses from `stdout` and any stray write will
corrupt the stream. The framework's `Logger` already writes to
`stderr` by default, so you don't need to change anything.

## API Reference

### McpAdapter options

```ts
McpAdapter({
  // Required
  name: 'my-api', // Server name shown in MCP client UIs

  // Optional
  version: '1.0.0', // Server version (default: '0.0.0')
  description: 'My API server', // Human-readable description
  mode: 'explicit', // 'explicit' (default) | 'auto'
  transport: 'http', // 'http' (default) | 'stdio' | 'sse'
  basePath: '/_mcp', // HTTP mount path (default: '/_mcp')
  include: ['GET', 'POST'], // Auto mode only: HTTP methods to expose
  exclude: ['/admin/*'], // Auto mode only: path prefixes to skip
  auth: {
    // Transport-level auth (HTTP/SSE only)
    type: 'bearer',
    validate: (token) => isValid(token),
  },
})
```

| Option        | Type                         | Default      | Description                               |
| ------------- | ---------------------------- | ------------ | ----------------------------------------- |
| `name`        | `string`                     | required     | MCP server name advertised to clients     |
| `version`     | `string`                     | `'0.0.0'`    | Server version advertised to clients      |
| `description` | `string`                     | —            | Human-readable description for client UIs |
| `mode`        | `'explicit' \| 'auto'`       | `'explicit'` | How routes are selected as tools          |
| `transport`   | `'http' \| 'stdio' \| 'sse'` | `'http'`     | Which MCP transport to use                |
| `basePath`    | `string`                     | `'/_mcp'`    | HTTP mount path for the MCP endpoint      |
| `include`     | `string[]`                   | —            | Auto mode: HTTP methods to include        |
| `exclude`     | `string[]`                   | —            | Auto mode: path prefixes to exclude       |
| `auth`        | `McpAuthOptions`             | —            | Transport-level bearer auth               |

### @McpTool options

```ts
@McpTool({
  // Required
  description: 'Create a task',

  // Optional
  name: 'create_task',                   // Override tool name
  inputSchema: z.object({ ... }),        // Override input schema
  outputSchema: z.object({ ... }),       // Output schema (docs only)
  hidden: true,                          // Exclude from auto mode
  examples: [{                           // Usage examples for client UIs
    description: 'Create a high-priority task',
    args: { title: 'Ship v3', priority: 'high' },
    result: { id: '1', title: 'Ship v3' },
  }],
})
```

| Option         | Type               | Default               | Description                                              |
| -------------- | ------------------ | --------------------- | -------------------------------------------------------- |
| `description`  | `string`           | required              | Shown to the LLM when deciding whether to call this tool |
| `name`         | `string`           | `Controller.method`   | Unique tool name across the server                       |
| `inputSchema`  | `ZodType`          | route's `body` schema | Override the auto-derived input schema                   |
| `outputSchema` | `ZodType`          | —                     | Output schema for documentation (not validated)          |
| `hidden`       | `boolean`          | `false`               | Exclude from auto mode exposure                          |
| `examples`     | `McpToolExample[]` | —                     | Input/output examples shown in client UIs                |

### Exported types

```ts
import {
  McpAdapter, // Adapter factory
  McpTool, // Method decorator
  getMcpToolMeta, // Read @McpTool metadata from a method
  isMcpTool, // Check if a method has @McpTool
  MCP_TOOL_METADATA, // Metadata key constant
} from '@forinda/kickjs-mcp'

import type {
  McpAdapterOptions, // McpAdapter() config shape
  McpToolOptions, // @McpTool() config shape
  McpToolDefinition, // Resolved tool definition
  McpToolExample, // Example input/output pair
  McpExposureMode, // 'explicit' | 'auto'
  McpTransport, // 'stdio' | 'sse' | 'http'
  McpAuthOptions, // Transport-level auth config
} from '@forinda/kickjs-mcp'
```

### getTools()

Inspect the discovered tools at runtime:

```ts
const adapter = McpAdapter({ name: 'my-api' })

// After bootstrap
const tools = adapter.getTools()
// Returns readonly McpToolDefinition[]

tools.forEach((t) => {
  console.log(t.name) // 'TaskController.create'
  console.log(t.description) // 'Create a task with title and priority'
  console.log(t.httpMethod) // 'POST'
  console.log(t.mountPath) // '/api/v1/tasks'
  console.log(t.inputSchema) // { type: 'object', properties: { title: ... } }
})
```

Use this in tests to verify the right routes are exposed:

```ts
it('exposes create but not internal routes', () => {
  const tools = adapter.getTools()
  const names = tools.map((t) => t.name)
  expect(names).toContain('TaskController.create')
  expect(names).not.toContain('TaskController.internal')
})
```

## Security

### What's in place

- **Explicit mode** (default) — only `@McpTool`-decorated routes are
  exposed. No code path allows a route into the tool surface without
  the decorator.
- **Full Express pipeline** — tool calls dispatch through the same
  middleware chain as regular HTTP. Guards, role checks, context
  decorators, rate limits, Zod validation, and request logging all
  apply.
- **Auth header forwarding** — the `Authorization` header from the
  MCP client's POST is extracted from the SDK's request info and
  forwarded to the internal dispatch. Your existing auth middleware
  sees the caller.
- **Zod input validation** — the MCP SDK validates tool arguments
  against the route's body schema before the callback fires. Invalid
  args never reach the handler.
- **`getTools()`** — inspect the resolved tool registry at runtime or
  assert on it in tests.

### What's not yet in place

- **Tool annotations** (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`) — the MCP spec supports these
  since revision 2025-03-26 for client approval UIs. On the roadmap.
- **Elicitation** (`elicitation/create`) — server-driven user
  prompts mid-tool-call. The highest-leverage server-side gate in
  the MCP spec. On the roadmap.
- **Process sandbox** — tools run in the same Node process as the
  app. Isolation is your existing auth + RBAC. For OS-level
  sandboxing, see
  [`@anthropic-ai/sandbox-runtime`](https://github.com/anthropic-experimental/sandbox-runtime).
- **Server-side approval** — no built-in human-in-the-loop gate.
  Approval today is the client's responsibility (Claude Code, Cursor
  both prompt the user before sending a tool call).

### Security mental model

Treat MCP exposure exactly like exposing the same route to a public
HTTP client. Your existing auth + RBAC + rate-limit story carries the
weight. The `@McpTool` decorator is the firewall — if you wouldn't be
comfortable putting a route behind `@Public()`, don't decorate it
with `@McpTool`.

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

## Next steps

- [AI package](./ai) — in-process provider, memory, and RAG that
  complements MCP for your own agent workflows
- [Authentication](./authentication) — strategies you can attach to
  MCP HTTP transports
- [Plugins](./plugins) — the canonical place to wire the adapter's
  dependencies
