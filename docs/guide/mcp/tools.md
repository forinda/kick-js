---
description: Which KickJS routes become MCP tools, custom tool providers, tool metadata and annotations, structured results, typed errors and timeouts.
---

# MCP Tools

A tool is something an MCP client can call. KickJS gives you two kinds:

- **Route tools:** a controller method, exposed with `@McpTool`, a route flag or `mode: 'auto'`. A call runs through the route's full pipeline: middleware, contributors, guards, validation.
- **Custom tools:** a function registered with `registerProvider()`, for tools that aren't routes. They can still call your routes with `ctx.fetch`.

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

### Exposing with route flags

[Route flags](../route-flags.md) can expose or hide tools without a
decorator on every method, including on controllers you don't own:

```ts
import { defineRouteFlag } from '@forinda/kickjs'
import { McpAdapter, type McpToolOptions } from '@forinda/kickjs-mcp'

export const Tool = defineRouteFlag<Partial<McpToolOptions>>('mcp.tool')
export const Hidden = defineRouteFlag('mcp.hidden')

McpAdapter({
  name: 'api',
  exposeWhen: 'mcp.tool', // routes carrying it become tools
  hideWhen: 'mcp.hidden', // routes carrying it never do
})
```

```ts
@Tool({ description: 'Manage webhooks' }) // every route in the controller
@Controller()
export class WebhooksController {
  @Get('/')
  list(ctx: RequestContext) {}

  @Tool.off // not this one
  @Delete('/:id')
  remove(ctx: RequestContext) {}
}

// On a module mount — for a controller from a plugin:
routes: () => ({ path: '/billing', controller: BillingController, flags: ['mcp.hidden'] })
```

- `exposeWhen` and `hideWhen` take the same forms as `skipWhen`: a name,
  `'!name'`, a list, or a predicate such as
  `({ route }) => route?.method === 'GET'`.
- A flag whose value is an object supplies any tool option: `description`,
  `name`, `title`, `annotations`, `scopes`, `outputSchema`, `hidden`. So a
  flag can carry everything `@McpTool` does:

  ```ts
  @Post('/refund')
  @Tool({ description: 'Refund a payment', annotations: { destructiveHint: true }, scopes: ['payments:write'] })
  refund(ctx: RequestContext) {}
  ```

  `@McpTool` on the method takes precedence. Set `name` only on
  method-level flags; the same name on several routes is a duplicate, and
  the extra tools are skipped.

- `hideWhen` wins over `@McpTool`, `exposeWhen` and `mode: 'auto'`.

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
  as the tool's input — described as what the tool accepts: a field with a
  `.default()` is optional, and a coerced or transformed field takes the type
  that's sent.
- `examples` are sent as the input schema's `examples` in `tools/list`,
  where clients show them and models learn from them. Keep them small and
  representative.
- Tool names default to the route's `name` option, falling back to
  `ControllerName.methodName`.

## Custom tool providers

Tools don't have to be routes. A **tool provider** is a named set of tools
with their own handlers, mounted on the adapter at any time — before
startup, or later from a plugin or module:

```ts
interface McpToolProvider {
  name: string
  tools: McpCustomTool[]
}

interface McpCustomTool<TArgs = any> {
  name: string // unique across the server, [A-Za-z0-9_.-]{1,128}
  description: string
  inputSchema?: unknown // any schema library; validated before the handler runs
  outputSchema?: unknown // advertised; an object result is sent as structuredContent
  title?: string
  annotations?: McpToolAnnotations
  scopes?: string[] // OAuth scopes the caller needs; otherwise 403 insufficient_scope
  handler(args: TArgs, ctx: McpToolContext): unknown
}

interface McpToolContext {
  headers: Headers // the MCP request's headers (credentials, tracing)
  principal?: McpPrincipal // who is calling, when auth.authenticate is set
  origin: string // the MCP request's scheme and host
  signal: AbortSignal // aborted when the client cancels the call
  fetch(request: Request): Promise<Response> // call the app's own routes
}
```

This local provider keeps team notes in memory and reports the app's
health through its built-in readiness probe:

```ts
import { z } from 'zod'
import type { McpToolProvider } from '@forinda/kickjs-mcp'

/** Team notes kept in memory: add, search, and check the app's health. */
function notesProvider(): McpToolProvider {
  const notes = new Map<string, { title: string; body: string }>()

  return {
    name: 'notes',
    tools: [
      {
        name: 'notes.add',
        description: 'Save a note with a title and a body. Returns the note id.',
        inputSchema: z.object({ title: z.string().min(1), body: z.string() }),
        handler: ({ title, body }: { title: string; body: string }) => {
          const id = crypto.randomUUID()
          notes.set(id, { title, body })
          return { id }
        },
      },
      {
        name: 'notes.search',
        description: 'Find notes whose title or body contains the query.',
        inputSchema: z.object({ query: z.string().min(1) }),
        handler: ({ query }: { query: string }) => {
          const needle = query.toLowerCase()
          return [...notes.entries()]
            .filter(([, n]) => `${n.title} ${n.body}`.toLowerCase().includes(needle))
            .map(([id, n]) => ({ id, title: n.title }))
        },
      },
      {
        name: 'app.health',
        description: "Report whether the app's dependencies are ready.",
        // ctx.fetch runs a request through the app's own pipeline — here the
        // built-in readiness probe — with the caller's cancellation.
        handler: async (_args: unknown, ctx) => {
          const res = await ctx.fetch(
            new Request('http://localhost/health/ready', { signal: ctx.signal }),
          )
          // Returning an MCP result sends it as is.
          return {
            content: [{ type: 'text', text: res.ok ? 'ready' : `not ready (${res.status})` }],
            isError: !res.ok,
          }
        },
      },
    ],
  }
}
```

Mount it from a plugin — the adapter is registered under `MCP_ADAPTER`:

```ts
import { MCP_ADAPTER } from '@forinda/kickjs-mcp'

export const NotesPlugin = {
  name: 'NotesPlugin',
  onReady(container) {
    container.resolve(MCP_ADAPTER).registerProvider(notesProvider())
  },
}
```

How provider tools behave:

- **Validation.** Arguments are checked against `inputSchema` before the
  handler runs; invalid arguments return an error result listing the
  issues. There is no route, so this is the only validation.
- **Results.** A string is sent as text, anything else as JSON text, and an
  object that is already an MCP result (`{ content: [...] }`) is sent as
  is. A thrown error becomes an error result with its message.
- **Security.** The endpoint's `auth` and `Origin` checks apply. Route
  middleware and guards don't — check `ctx.headers` in the handler, or
  call a guarded route with `ctx.fetch`.
- **Names** must be unique across routes and providers;
  `registerProvider` throws on a clash. Registering a provider with the
  same name replaces it.
- **Change notifications.** Mounting or unmounting
  (`unregisterProvider(name)`) sends `tools/list_changed` to connected
  clients, which re-read the tool list.
- Route flags, `mode`, `include` and `exclude` apply to route tools only.

The example is exercised as a test in
`packages/mcp/__tests__/example-local-tool-provider.test.ts`.

### What a custom tool's handler gets

`handler(args, ctx)` receives the validated arguments and:

| `ctx.`      | What it is                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| `principal` | who is calling, when [`auth.authenticate`](./auth.md#who-is-calling-auth-authenticate) is set                |
| `origin`    | the MCP request's scheme and host; build requests to your own routes from it, so they keep the caller's host |
| `headers`   | the MCP request's headers                                                                                    |
| `signal`    | aborted when the client cancels, or at `toolTimeoutMs`                                                       |
| `fetch`     | runs a `Request` through the app's pipeline                                                                  |
| `elicit`    | asks the user for input mid-call; see [Asking the user](#asking-the-user-elicitation)                        |

```ts
handler: async ({ invoiceId }, ctx) => {
  const res = await ctx.fetch(
    new Request(new URL(`/api/v1/invoices/${invoiceId}`, ctx.origin), {
      headers: { authorization: ctx.headers.get('authorization') ?? '' },
      signal: ctx.signal,
    }),
  )
  return res.json()
}
```

## Asking the user (elicitation)

A custom tool can stop and ask the user for something: a confirmation before a destructive action, a field the model didn't have. `ctx.elicit(key, { message, schema })` returns the answer, validated against `schema`, or `undefined` when the user declines or cancels:

```ts
handler: async ({ invoiceId }, ctx) => {
  const ok = await ctx.elicit<{ confirm: boolean }>('confirm', {
    message: `Void invoice ${invoiceId}? This can't be undone.`,
    schema: z.object({ confirm: z.boolean() }),
  })
  if (!ok?.confirm) return 'Cancelled'
  return voidInvoice(invoiceId)
}
```

- **The handler runs again from the top for each answer.** The first `elicit` of a key stops the handler, and the client asks the user. When the answer arrives, the handler runs again and `elicit` returns it. Earlier answers are kept, so a second `elicit` doesn't ask the first question again. Code before an `elicit` must be safe to repeat, so do side effects after the last one.
- **`schema` is a flat form:** an object of string, number, boolean or enum fields, from any schema library. Clients render it as a form.
- **Both protocol eras work.** A 2026-07-28 client gets an `input_required` result and retries with the answer. On a 2025 session the SDK sends the client a real `elicitation/create` request. Under `stateless: true`, 2025 clients can't be asked (there's no session to ask over), so the call fails. 2026-07-28 clients work in either mode.
- **Answers carried between rounds are signed** (HMAC) and bound to the caller, the call's arguments and the question asked, so a client can't forge them, replay an approval against other arguments, or answer a question the tool didn't ask. Each process signs with its own random key. When several instances serve one endpoint, set the same `requestStateKey` (32+ bytes) on each.
- The client must support elicitation. Route tools can't ask; put the question in a custom tool.

## Titles and annotations

Annotations are hints for the client: a client may ask for confirmation before a destructive tool, and skip it for a read-only one.

A route tool starts from what its HTTP method says, and `annotations` override any of them:

| Method          | Default annotations                                                    |
| --------------- | ---------------------------------------------------------------------- |
| `GET`, `HEAD`   | `readOnlyHint: true`, `idempotentHint: true`                           |
| `PUT`           | `readOnlyHint: false`, `idempotentHint: true`                          |
| `DELETE`        | `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true` |
| `POST`, `PATCH` | `readOnlyHint: false`                                                  |

```ts
@Delete('/:id')
@McpTool({
  description: 'Void an invoice. It stays on record, marked void.',
  title: 'Void invoice',
  annotations: { destructiveHint: true, idempotentHint: true },
})
void(ctx: RequestContext) {}
```

| Annotation        | Means                                                         |
| ----------------- | ------------------------------------------------------------- |
| `readOnlyHint`    | the tool changes nothing                                      |
| `destructiveHint` | it may delete or overwrite (when not read-only)               |
| `idempotentHint`  | calling it again with the same arguments changes nothing more |
| `openWorldHint`   | it reaches outside your system                                |

They're hints, not enforcement: a client that ignores them can still call the tool. Enforce permissions in the route ([Authentication](./auth.md)). Custom tools take the same `title` and `annotations` fields.

## Results

A route tool returns the route's response body as text. On top of that:

- **Structured content.** When the tool declares an `outputSchema`, the schema is advertised in `tools/list`, and a JSON object response is also sent as `structuredContent`, which clients can use without parsing text:

  ```ts
  @Get('/:id', { response: invoiceSchema })
  @McpTool({ description: 'One invoice', outputSchema: invoiceSchema })
  get(ctx: RequestContext) {}
  ```

  A custom tool with an `outputSchema` sends an object result the same way.

- **Accepted, not done.** A `202 Accepted` — an approval queue, a background job — is sent as text starting `Accepted (202)`, and never as `structuredContent`: its body isn't the tool's result. On a tool with an `outputSchema` it's also marked `isError`, since a success has to match that schema and clients check it.

- **Errors.** A response with status 400 or above is an error result (`isError: true`). When the body is JSON (a thrown `HttpException` answers [Problem Details](../error-handling.md)), it's sent as `structuredContent` too, so the model sees `status`, `type` and `detail` as fields:

  ```json
  { "isError": true, "structuredContent": { "status": 404, "detail": "No such invoice" } }
  ```

### Typed errors from custom tools

Throw `McpToolError(code, message, data)` from a custom tool to return an error the model can act on: `structuredContent.error` carries the code and data.

```ts
import { McpToolError } from '@forinda/kickjs-mcp'

handler: async ({ invoiceId }) => {
  const approval = await approvals.request('void-invoice', invoiceId)
  throw new McpToolError('approval_pending', 'A manager has to approve this', {
    approvalId: approval.id,
  })
}
// → { isError: true, structuredContent: { error: { code: 'approval_pending', message: '…', approvalId: 'ap_1' } } }
```

Any other thrown error becomes an error result with its message. Invalid arguments to a custom tool return `{ error: { code: 'invalid_arguments', issues } }`.

### Timeouts

`toolTimeoutMs` ends a call that runs longer, with `{ error: { code: 'timeout' } }`:

```ts
McpAdapter({ name: 'billing', toolTimeoutMs: 30_000 })
```

The route's request is aborted (its `ctx.signal` fires), and a custom tool's `ctx.signal` too. A handler that ignores the signal still gets its result discarded at the timeout.

### Unknown tools

Calling a tool that doesn't exist, or one a [`toolFilter`](./multi-tenant.md#per-caller-tools-toolfilter) hides from this caller, answers JSON-RPC error `-32602` (invalid params), as the MCP spec asks. Clients show it as a failed call rather than a tool result.
