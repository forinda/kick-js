---
description: Testing a KickJS MCP server — asserting which tools are exposed, calling tools through the SDK client, raw JSON-RPC against a stateless endpoint, and the MCP Inspector.
---

# Testing MCP

## Which tools are exposed

`getTools()` returns the tools discovered at startup, which is enough to check that the right routes are exposed and the wrong ones aren't:

```ts
import { createTestApp } from '@forinda/kickjs-testing'
import { MCP_ADAPTER, McpAdapter, type McpAdapterInstance } from '@forinda/kickjs-mcp'

it('exposes create, not the admin routes', async () => {
  const { container } = await createTestApp({
    modules: [TaskModule()],
    adapters: [McpAdapter({ name: 'tasks' })],
  })
  const names = (container.resolve(MCP_ADAPTER) as McpAdapterInstance).getTools().map((t) => t.name)

  expect(names).toContain('TaskController.create')
  expect(names).not.toContain('AdminController.purge')
})
```

Each definition also has `inputSchema`, `httpMethod`, `mountPath`, `annotations` and `scopes`, for asserting on what a client will see.

## Calling tools through the SDK client

To test a tool end to end (the MCP endpoint, auth, dispatch through the route), start the app on a free port and connect the MCP SDK's own client:

```ts
import type { AddressInfo } from 'node:net'
import { Application } from '@forinda/kickjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

let app: Application
let client: Client

beforeAll(async () => {
  app = new Application({
    modules: [TaskModule()],
    adapters: [McpAdapter({ name: 'tasks', path: '/mcp' })],
    port: 0,
  })
  await app.start()
  const { port } = app.getHttpServer()!.address() as AddressInfo

  client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${signTestToken({ sub: 'u1' })}` } },
    }),
  )
})

afterAll(async () => {
  await client.close()
  await app.shutdown()
})

it('creates a task', async () => {
  const result = await client.callTool({
    name: 'TaskController.create',
    arguments: { title: 'Ship it' },
  })
  expect(result.isError).toBe(false)
})
```

`signTestToken` is your own helper that signs a token your auth accepts ([Testing Authentication](../testing/auth.md#a-token-the-app-accepts)).

## Raw requests to a stateless endpoint

With `stateless: true` there's no session to set up, so each JSON-RPC message is one HTTP request. That makes it easy to test exactly what a client sends, including the `Host` header for a tenant per host. Node's `fetch` can't set `Host`, so use `node:http`:

```ts
import http from 'node:http'

function rpc(port: number, host: string, token: string, method: string, params = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }>(
    (resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/mcp',
          headers: {
            host, // the tenant
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: data && JSON.parse(data),
            }),
          )
        },
      )
      req.on('error', reject)
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }))
    },
  )
}

it('hides the admin tools from a member of acme', async () => {
  const res = await rpc(port, 'acme.localhost', memberToken, 'tools/list')
  expect(res.body.result.tools.map((t: { name: string }) => t.name)).not.toContain(
    'InvoiceController.void',
  )
})

it('refuses a token for another tenant', async () => {
  const res = await rpc(port, 'acme.localhost', globexToken, 'tools/list')
  expect(res.status).toBe(401)
  expect(res.headers['www-authenticate']).toContain('resource_metadata=')
})
```

## Custom tools

A custom tool's handler is a function, so most of its logic is tested by calling it directly with a fake context:

```ts
const ctx = {
  headers: new Headers(),
  origin: 'http://acme.localhost',
  principal: { subject: 'u1', scopes: [] },
  signal: new AbortController().signal,
  fetch: (req: Request) => app.fetch(req),
}
expect(await reports.tools[0].handler({ month: '2026-09' }, ctx)).toMatchObject({ total: 1200 })
```

Then call it once through the client, to check it's registered and its arguments validate.

## The MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a browser UI for connecting to a server, listing its tools and calling them by hand: the quickest way to see what a client sees.

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

| Symptom                                                | Cause                                                            | Fix                                                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 404 on connect                                         | Wrong URL — missing `/_mcp/messages`                             | Use the full path: `http://localhost:<port>/_mcp/messages`                                                                                   |
| `403` "origin … is not allowed"                        | A browser-based client sent an `Origin` header                   | Add that origin to `allowedOrigins`, e.g. `allowedOrigins: ['http://localhost:6274']` for the Inspector UI                                   |
| `401` on connect                                       | `auth` is set and the request has no valid credential            | Send the `Authorization` header your `auth.validate` expects                                                                                 |
| "Not Acceptable: Client must accept text/event-stream" | Opened `/_mcp/messages` directly in a browser tab                | Use the Inspector UI, not a direct browser navigation — the endpoint expects JSON-RPC POST requests                                          |
| CORS errors in browser console                         | Connecting from a different origin without CORS configured       | Add `cors()` middleware in your bootstrap: `middlewares: [cors({ origin: '*', exposedHeaders: ['mcp-session-id'] }), express.json()]`        |
| Tool calls return "Not authenticated"                  | Auth header not configured in the Inspector                      | Expand Authentication, enable the Authorization header, set the value                                                                        |
| Tools not showing up                                   | Methods not decorated with `@McpTool` in explicit mode           | Add `@McpTool({ description: '...' })` to each method you want to expose                                                                     |
| `@Autowired()` service is undefined (500 on tool call) | Running with `tsx`/`ts-node` which don't emit decorator metadata | Use explicit token: `@Autowired(MyService)` instead of bare `@Autowired()` — see [DI caveats](#a-tool-answers-500-autowired-under-tsx) below |

### Inspector quick-start checklist

Follow this exact sequence to avoid the common pitfalls:

1. **Start your server**:

   ```bash
   kick dev
   ```

2. **Start the Inspector** in a separate terminal:

   ```bash
   npx @modelcontextprotocol/inspector
   ```

3. **Copy the full URL** from the Inspector output — it includes the
   proxy auth token:

   ```text
   http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=<token>
   ```

   Open that URL in your browser. Without the token, the Inspector
   proxy rejects connections with "Did you add the proxy session
   token in Configuration?"

4. **Set the URL** to your server's MCP endpoint:

   ```text
   http://localhost:<your-port>/_mcp/messages
   ```

   The `/_mcp/messages` suffix is required. Without it, the
   Inspector connects to your server root and gets a 404.

5. **If you sent a raw `initialize` request** (with `curl`, say), it
   created its own session — it doesn't block the Inspector. The session
   ends when that client sends `DELETE`, after the idle timeout, or when
   the app shuts down.

6. **Click Connect** — green dot + server name should appear.

7. **Click List Tools** — your `@McpTool`-decorated methods appear.

8. **If something goes wrong** — click **Disconnect**, then **Connect**
   again; the Inspector starts a new session.

### A tool answers 500: `@Autowired` under tsx

When running your app with `tsx`, `ts-node`, or any runner that
doesn't emit TypeScript decorator metadata, bare `@Autowired()`
can't resolve the type and the injected property stays `undefined`.

```ts
// This works with `kick dev` (Vite + SWC emit metadata)
// but FAILS with `tsx src/index.ts`:
@Autowired() private readonly taskService!: TaskService  // undefined!

// This works everywhere — always use the explicit token:
@Autowired(TaskService) private readonly taskService!: TaskService  // works
```

**Why:** `@Autowired()` with no argument relies on
`emitDecoratorMetadata` (the `Reflect.getMetadata('design:type', ...)`
reflection API) to discover the type at runtime. `tsx` and `ts-node`
strip type information during transpilation and don't emit the
metadata, so the DI container sees `undefined` as the token.

**The fix is always the same:** pass the class (or injection token)
explicitly: `@Autowired(TaskService)`, `@Autowired(MY_TOKEN)`.

`kick dev` uses Vite + SWC which does emit decorator metadata, so
bare `@Autowired()` works there. But since developers often use `tsx`
for scripts, tests, or quick runs, the explicit form is safer as a
default habit.

This applies to all DI injection, not just MCP — but it's especially
visible with MCP because tool calls that hit an uninjected service
return a generic 500 "Internal Server Error" with no obvious cause.
