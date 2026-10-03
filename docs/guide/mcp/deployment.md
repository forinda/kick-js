---
description: Running a KickJS MCP server — Streamable HTTP and stdio, the endpoint path, stateless mode for several instances, sessions and their limits, CORS for browser clients, and stdio logging.
---

# MCP Deployment

## Transports

MCP supports three transports; pick the one that matches your
deployment:

| Transport | When to use                                  | Auth mechanism                 |
| --------- | -------------------------------------------- | ------------------------------ |
| `http`    | Remote clients, web UIs, load balancers      | `Authorization` header on POST |
| `stdio`   | Local CLI clients (Claude Code, Cursor, Zed) | Inherits parent process env    |
| `sse`     | Legacy (aliases to HTTP internally)          | Same as HTTP                   |

Both transports dispatch through the same request pipeline — same
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
              Same request pipeline
              Same middleware
              Same context decorators
              Same auth flow
```

### Stdio (local clients)

Use the CLI to run a KickJS app as an MCP stdio server:

<PmCommand exec="kick mcp start" />

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

<PmCommand exec="kick mcp init   # writes .mcp.json" />

### HTTP (remote clients)

The endpoint is `/_mcp/messages` by default. Once the app is running:

```text
https://your-app.example.com/_mcp/messages
```

Add it to your client's MCP config as an HTTP server. `path` sets the whole endpoint path, `basePath` only the part before `/messages`:

```ts
McpAdapter({ name: 'billing', path: '/mcp' }) // https://your-app.example.com/mcp
```

## Protocol versions

One endpoint serves every protocol revision the MCP SDK supports:

- **2026-07-28 clients** are served statelessly: each request carries what it needs, and a fresh server answers it. This happens in either mode, so they scale across instances with no extra setup. List-changed notifications reach them over their `subscriptions/listen` stream.
- **2025 clients** (`2025-11-25` and earlier, the ones that send `initialize`) get a session, or are served statelessly with `stateless: true`, as described below.

The adapter tells them apart per request, so new and older clients can share the endpoint while clients upgrade. Over stdio, the connection's first message picks the era.

## Several instances: `stateless`

By default each 2025 client gets a session held in the server's memory: `initialize` creates it, and later requests carry its `Mcp-Session-Id`. Behind a load balancer, a request that reaches another instance gets 404 "Session not found".

`stateless: true` serves every request with a fresh MCP server and no session:

```ts
McpAdapter({ name: 'billing', path: '/mcp', stateless: true })
```

- **Any instance can answer any request**, so no sticky routing or shared session store is needed.
- **POST only:** responses are plain JSON. `GET` (the notification stream) and `DELETE` (ending a session) answer 405, since there's no session to stream from or end.
- **No session limits:** `maxSessions` and `sessionIdleTimeoutMs` don't apply.
- **No server-to-client notifications for 2025 clients.** `tools/list_changed` after `registerProvider()` doesn't reach them; they see the new list the next time they ask. They also can't be asked questions (`ctx.elicit`).
- **Auth runs on every request** in both modes, so stateless loses no security. Everything a call needs (the token, the host) comes with each request.

Use stateless for remote servers that scale out. Keep sessions for a single instance where clients want notifications.

### Sessions

Each client that sends `initialize` gets its own session, identified by
the `mcp-session-id` response header. Several clients (the Inspector,
Claude Code, a script) can be connected at the same time.

A session ends when the client disconnects (`DELETE /_mcp/messages`),
when its connection closes, after `sessionIdleTimeoutMs` (default 30
minutes) with no request in progress, or when the app shuts down. A
client holding its notification stream open is not idle. A request with
an unknown session id gets `404`, and the client starts a new session.

At most `maxSessions` (default 1000) are open at once; a new client
beyond that gets `503` until a session ends. `initialize` needs no
session, so the limit applies whether or not `auth` is set.

Sessions live in the server's memory. Behind a load balancer with
several instances, route each client to the same instance (sticky
sessions), or a request can land on an instance that doesn't know its
session.

In stateless mode none of this applies: there are no sessions.

### CORS for HTTP transport

If the Inspector (or any browser-based MCP client) connects to your
server, you need CORS middleware with the `mcp-session-id` header
exposed:

```ts
import { bootstrap, cors } from '@forinda/kickjs'

export const app = await bootstrap({
  modules,
  middlewares: [
    cors({
      origin: '*',
      exposedHeaders: ['mcp-session-id'],
    }),
    express.json(),
  ],
  adapters: [McpAdapter({ name: 'my-api' })],
})
```

Without `exposedHeaders: ['mcp-session-id']`, the Inspector proxy
can't read the session ID from the `initialize` response, and every
subsequent request fails with "Mcp-Session-Id header is required".

This is only needed for HTTP transport. Stdio transport (used by
Claude Code, Cursor, Zed) doesn't go through a browser and doesn't
need CORS.

## Logging under stdio

For stdio transport, log to `stderr` — never `stdout` — because the
MCP client reads responses from `stdout` and any stray write will
corrupt the stream. The framework's `Logger` already writes to
`stderr` by default, so you don't need to change anything.
