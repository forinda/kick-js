# @forinda/kickjs-ws

WebSocket support for KickJS applications via the lightweight [`ws`](https://github.com/websockets/ws) library, using the same decorator-driven approach as HTTP controllers.

## Installation

```bash
pnpm add @forinda/kickjs-ws ws
```

## Exports

### Decorators

| Decorator | Description |
|-----------|-------------|
| `@WsController(namespace)` | Mark a class as a WebSocket controller bound to a namespace |
| `@OnConnect()` | Handle new socket connections |
| `@OnDisconnect()` | Handle socket disconnections |
| `@OnMessage(event)` | Handle a named message event |
| `@OnError()` | Handle socket errors |

### Adapter

| Export | Description |
|--------|-------------|
| `WsAdapter` | AppAdapter that mounts Socket.IO on the HTTP server |

### Context

| Export | Description |
|--------|-------------|
| `WsContext` | Context object passed to all WebSocket handler methods |

### Types

| Export | Description |
|--------|-------------|
| `WsControllerMeta` | Metadata stored by `@WsController` |
| `WsHandlerMeta` | Metadata stored by `@OnMessage` and other handler decorators |
| `WsAdapterOptions` | Configuration options for `WsAdapter` |

## WsAdapter Options

```ts
interface WsAdapterOptions {
  /** Socket.IO server options (cors, transports, etc.) */
  serverOptions?: Partial<ServerOptions>
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number
  /** Heartbeat timeout in ms (default: 5000) */
  heartbeatTimeout?: number
}
```

## WsContext

Every handler method receives a `WsContext` with:

| Property | Type | Description |
|----------|------|-------------|
| `socket` | `Socket` | The raw Socket.IO socket |
| `data` | `any` | The message payload |
| `server` | `Server` | The Socket.IO server instance |
| `nsp` | `Namespace` | The namespace this socket belongs to |
| `rooms` | `Set<string>` | Rooms the socket has joined |

### Methods

| Method | Description |
|--------|-------------|
| `ctx.emit(event, data)` | Emit to the current socket |
| `ctx.broadcast(event, data)` | Emit to all others in the namespace |
| `ctx.toRoom(room, event, data)` | Emit to all sockets in a room |
| `ctx.join(room)` | Join a room |
| `ctx.leave(room)` | Leave a room |

## Usage

See the [WebSocket guide](../guide/websockets.md) for full examples.

```ts
import { WsController, OnConnect, OnMessage, OnDisconnect } from '@forinda/kickjs-ws'
import type { WsContext } from '@forinda/kickjs-ws'

@WsController('/chat')
export class ChatController {
  @OnConnect()
  onConnect(ctx: WsContext) {
    console.log(`Connected: ${ctx.socket.id}`)
  }

  @OnMessage('send')
  onSend(ctx: WsContext) {
    ctx.broadcast('message', ctx.data)
  }

  @OnDisconnect()
  onDisconnect(ctx: WsContext) {
    console.log(`Disconnected: ${ctx.socket.id}`)
  }
}
```

## Using Socket.IO Instead

The built-in WS package uses the lightweight `ws` library. If you prefer Socket.IO, create a custom adapter:

```ts
import { Server } from 'socket.io'
import type { AppAdapter, Container } from '@forinda/kickjs-core'

export class SocketIOAdapter implements AppAdapter {
  readonly name = 'SocketIOAdapter'
  private io!: Server

  afterStart(app: any) {
    const httpServer = app.__kickApp?.getHttpServer()
    if (!httpServer) return

    this.io = new Server(httpServer, {
      cors: { origin: '*' },
    })

    this.io.on('connection', (socket) => {
      console.log(`Connected: ${socket.id}`)
      socket.on('disconnect', () => console.log(`Disconnected: ${socket.id}`))
    })
  }

  async shutdown() {
    this.io?.close()
  }
}
```

Register it in `bootstrap()`:

```ts
bootstrap({
  modules,
  adapters: [new SocketIOAdapter()],
})
```

## Related

- [WebSocket Guide](../guide/websockets.md) — full walkthrough with rooms, auth, heartbeat
- [WebSocket Example](../examples/ws-api.md) — chat app with notifications
- [DevTools `/_debug/ws`](../guide/devtools.md) — live WebSocket metrics
- [@forinda/kickjs-core](./core.md) — DI container, decorators
- [@forinda/kickjs-http](./http.md) — HTTP server that WsAdapter attaches to
