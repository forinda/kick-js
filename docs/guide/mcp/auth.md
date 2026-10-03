---
description: Authenticating MCP clients in KickJS — the endpoint check, who is calling with auth.authenticate, OAuth protected-resource metadata, challenges, audiences and scopes, and auth inside tool calls.
---

# MCP Authentication

Two layers check an MCP request, and most apps use both:

1. **The endpoint** (`auth` on the adapter) checks every request to the MCP endpoint: `initialize`, `tools/list` and each `tools/call`. It decides whether the client may talk to the server at all, and who it is.
2. **The route** checks each tool call as it would any HTTP request: your auth contributors, guards and role checks run in the route's pipeline, because a tool call _is_ a request to the route, carrying the caller's `Authorization` header.

## The endpoint check: `auth`

The simplest form is a yes or no:

```ts
McpAdapter({
  name: 'billing',
  auth: { type: 'bearer', validate: (token) => tokens.isValid(token) },
})
```

- **`type: 'bearer'`** passes the token from `Authorization: Bearer <token>`. A missing or malformed header is refused without calling `validate`.
- **`type: 'custom'`** passes the raw `Authorization` value (`''` when absent).

A refused request gets 401 with `WWW-Authenticate: Bearer`. The check runs on every request, so a revoked token stops working mid-session.

## Who is calling: `auth.authenticate`

`authenticate` returns the caller instead of a yes or no. Return `null` to refuse:

```ts
import type { McpPrincipal } from '@forinda/kickjs-mcp'

McpAdapter({
  name: 'billing',
  auth: {
    type: 'bearer',
    authenticate: async (token, request): Promise<McpPrincipal | null> => {
      const claims = await verifyAccessToken(token) // your JWT / introspection check
      if (!claims) return null
      return {
        subject: claims.sub,
        clientId: claims.client_id,
        scopes: claims.scope.split(' '),
        audience: claims.aud,
        tenantId: claims.tenant, // anything else you need
      }
    },
  },
})
```

The principal reaches:

- custom tool handlers, as `ctx.principal` ([Tools](../tools.md#what-a-custom-tool-s-handler-gets));
- `toolFilter`, as `call.principal`, to decide which tools this caller sees ([Multi-Tenancy](../multi-tenant.md#per-caller-tools-toolfilter));
- tool scope checks (below).

Route tools don't receive it directly. They get the caller's `Authorization` header (`forwardHeaders`) and authenticate it in their own pipeline, as they would for any request.

### Audience

A token should only work at the server it was issued for (RFC 8707). When the principal has an `audience`, it must name this request's resource URL (`request.resource`: the request's origin plus the endpoint path, e.g. `https://acme.example.com/mcp`), or the request gets 401. With one server per tenant host, a token minted for `acme.example.com` is refused at `globex.example.com`.

Leave `audience` out to skip the check, if your token validation already did it.

## OAuth for remote clients

Remote MCP clients use OAuth 2.1: on a 401 they read the server's protected-resource metadata, find its authorization server, sign the user in, and retry with the token. The adapter serves the resource-server half; the authorization server is yours, or a hosted identity provider.

```ts
McpAdapter({
  name: 'billing',
  path: '/mcp',
  auth: {
    type: 'bearer',
    authenticate: verify,
    scopes: ['invoices:read'], // named in the 401 challenge
  },
  protectedResource: {
    authorizationServers: ['https://auth.example.com'],
    scopesSupported: ['invoices:read', 'invoices:write'],
  },
})
```

- **Metadata (RFC 9728).** `protectedResource` serves this at `/.well-known/oauth-protected-resource` and at that path plus the endpoint path, for each host:

  ```json
  {
    "resource": "https://acme.example.com/mcp",
    "authorization_servers": ["https://auth.example.com"],
    "scopes_supported": ["invoices:read", "invoices:write"],
    "bearer_methods_supported": ["header"]
  }
  ```

  `authorizationServers` (and `resource`) can be functions of the request, for an authorization server per tenant.

- **The 401 challenge** names where the metadata is:

  ```http
  WWW-Authenticate: Bearer resource_metadata="https://acme.example.com/.well-known/oauth-protected-resource/mcp", scope="invoices:read"
  ```

  It points at the `protectedResource` route by default. Set `auth.resourceMetadataUrl` (a string, or a function of the request) to point elsewhere.

### Scopes per tool

Give a tool the scopes it needs:

```ts
@Post('/:id/void')
@McpTool({ description: 'Void an invoice', scopes: ['invoices:write'] })
void(ctx: RequestContext) {}
```

A `tools/call` from a principal without them is refused before the tool runs, with 403 and a challenge naming the missing scopes. A client can then ask the user for more access and retry (step-up):

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="invoices:write", resource_metadata="…"
```

Scopes are checked against `principal.scopes`, so they need `authenticate`. With `validate`, or without `auth`, a tool with scopes can't be called at all. Custom tools take `scopes` too.

Scopes say what a client may ask for. Who may do what is still your app's permission check, in the route.

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
request pipeline.

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

MCP tool calls flow through the same request pipeline as regular
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
