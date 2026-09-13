# WebSocket Support

KickJS provides decorator-driven WebSocket support with namespaces, rooms, and full DI integration. Built on the lightweight `ws` library.

## Setup

```ts
import { bootstrap } from '@forinda/kickjs'
import { WsAdapter } from '@forinda/kickjs-ws'

bootstrap({
  modules: [ChatModule],
  adapters: [WsAdapter({ path: '/ws' })],
})
```

Clients connect to: `ws://localhost:3000/ws/chat`

## Decorators

### @WsController

Mark a class as a WebSocket controller with a namespace path. Automatically registered in the DI container.

```ts
import { WsController, OnConnect, OnMessage, OnDisconnect } from '@forinda/kickjs-ws'
import type { WsContext } from '@forinda/kickjs-ws'

@WsController('/chat')
export class ChatController {
  @Autowired() private chatService!: ChatService

  @OnConnect()
  handleConnect(ctx: WsContext) {
    console.log(`Client ${ctx.id} connected`)
    ctx.send('welcome', { id: ctx.id })
  }

  @OnMessage('send')
  handleSend(ctx: WsContext) {
    this.chatService.saveMessage(ctx.data)
    ctx.broadcast('receive', ctx.data)
  }

  @OnDisconnect()
  handleDisconnect(ctx: WsContext) {
    console.log(`Client ${ctx.id} disconnected`)
  }
}
```

### @OnConnect

Called when a client connects to the namespace.

### @OnDisconnect

Called when a client disconnects.

### @OnMessage(event)

Called when a message with the matching event name is received. Use `'*'` as a catch-all for unmatched events.

```ts
@OnMessage('chat:send')
handleSend(ctx: WsContext) {
  ctx.send('chat:ack', { ok: true })
}

@OnMessage('*')
handleUnknown(ctx: WsContext) {
  ctx.send('error', { message: `Unknown event: ${ctx.event}` })
}
```

### @OnError

Called on WebSocket errors or invalid JSON messages.

```ts
@OnError()
handleError(ctx: WsContext) {
  console.error('WS error:', ctx.data)
}
```

## Message Format

Messages must be JSON with an `event` and `data` field:

```json
{ "event": "chat:send", "data": { "text": "hello", "room": "general" } }
```

## WsContext

Every handler receives a `WsContext` with these properties and methods:

| Property/Method                  | Description                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `ctx.id`                         | Unique connection ID                                                         |
| `ctx.data`                       | Parsed message payload                                                       |
| `ctx.event`                      | Event name from the message                                                  |
| `ctx.namespace`                  | Namespace path                                                               |
| `ctx.socket`                     | Raw WebSocket instance                                                       |
| `ctx.request`                    | The HTTP upgrade `IncomingMessage` — read cookies, headers, query, client IP |
| `ctx.cookies`                    | Parsed cookie map from the upgrade `Cookie` header                           |
| `ctx.get(key)`                   | Get metadata value                                                           |
| `ctx.set(key, value)`            | Set metadata (persists for connection lifetime)                              |
| `ctx.send(event, data)`          | Send to this client                                                          |
| `ctx.broadcast(event, data)`     | Send to all clients in namespace except sender                               |
| `ctx.broadcastAll(event, data)`  | Send to all clients in namespace including sender                            |
| `ctx.join(room)`                 | Join a room                                                                  |
| `ctx.leave(room)`                | Leave a room                                                                 |
| `ctx.rooms()`                    | Get rooms this client is in                                                  |
| `ctx.to(room).send(event, data)` | Send to all clients in a room                                                |

## Rooms

```ts
@OnMessage('room:join')
handleJoin(ctx: WsContext) {
  ctx.join(ctx.data.room)
  ctx.to(ctx.data.room).send('room:joined', { user: ctx.id })
}

@OnMessage('room:message')
handleRoomMessage(ctx: WsContext) {
  ctx.to(ctx.data.room).send('room:message', {
    from: ctx.id,
    text: ctx.data.text,
  })
}

@OnMessage('room:leave')
handleLeave(ctx: WsContext) {
  ctx.leave(ctx.data.room)
}
```

Rooms are automatically cleaned up when a client disconnects.

::: tip Room names are shared across namespaces
A room called `lobby` joined from `/ws/chat` and one joined from `/ws/admin` are the **same room**. That is deliberate — it is what lets a service broadcast through `WS_ROOM_MANAGER`, and lets `user:<id>` reach a user's sockets in every namespace. When two namespaces must not overlap, prefix the names: `chat:lobby`, `admin:lobby`.
:::

## Multiple Namespaces

Each `@WsController` creates a separate namespace:

```ts
@WsController('/chat')
export class ChatController {
  /* ... */
}

@WsController('/notifications')
export class NotificationController {
  /* ... */
}
```

- `ws://localhost:3000/ws/chat` → ChatController
- `ws://localhost:3000/ws/notifications` → NotificationController

## Configuration

```ts
WsAdapter({
  path: '/ws', // Base path (default: '/ws')
  heartbeatInterval: 30000, // Ping interval in ms (default: 30000, 0 to disable)
  maxPayload: 1048576, // Max message size in bytes
})
```

## Authenticated Handshake

Pass an `auth` block to authenticate sockets at upgrade time using cookies, headers, or query string. The hook runs once per socket before any `@OnConnect` handler fires. Return `null` (or throw) to reject — the socket closes with code `4401`.

Clients usually send as soon as the socket opens, which can be before `resolveUser` settles. Those messages are held and delivered after `@OnConnect`, in order — up to 64 messages or 1 MiB; beyond either the socket closes with `1008`, since the sender is not yet authenticated. A client that disconnects while `resolveUser` runs never reaches `@OnConnect`.

An `async` `@OnConnect` is awaited the same way, with or without `auth`: messages that arrive while it runs are held (under the same limits) and delivered once it settles, so `@OnMessage` never sees a socket whose connect setup is unfinished.

```ts
import { WsAdapter } from '@forinda/kickjs-ws'

WsAdapter({
  path: '/ws',
  auth: {
    resolveUser: async (request) => {
      const token = parseCookie(request.headers.cookie).sid
      return token ? await sessions.verify(token) : null
    },
    autoJoinUserRoom: true, // opt sockets into `user:<id>` (default: true)
    userRoomPrefix: 'user:', // room prefix (default: 'user:')
  },
})
```

Inside handlers, the resolved user is stashed on the context:

```ts
@OnConnect()
handleConnect(ctx: WsContext) {
  const user = ctx.get<{ id: string }>('user')
  ctx.send('welcome', { userId: user?.id })
}
```

## Dependency Injection

The adapter registers three tokens on the DI container during startup so any service can broadcast without holding a `WsContext` reference:

| Token                 | Type                | Purpose                                                             |
| --------------------- | ------------------- | ------------------------------------------------------------------- |
| `WS_ADAPTER`          | `WsAdapter`         | The live adapter — call `broadcastToUser(id, event, data)` directly |
| `WS_ROOM_MANAGER`     | `RoomManager`       | Low-level room broadcast primitive                                  |
| `WS_USER_BROADCASTER` | `WsUserBroadcaster` | High-level per-user helper (`toUser(id).send(...)`)                 |

```ts
import { Service, Inject } from '@forinda/kickjs'
import { WS_USER_BROADCASTER, type WsUserBroadcaster } from '@forinda/kickjs-ws'

@Service()
export class NotificationService {
  constructor(@Inject(WS_USER_BROADCASTER) private readonly ws: WsUserBroadcaster) {}

  async notify(userId: string, message: string) {
    this.ws.toUser(userId).send('notification', { message })
  }
}
```

Equivalent call styles:

```ts
this.ws.toUser(userId).send('notification', payload)
this.ws.broadcastToUser(userId, 'notification', payload)
```

### When `auth.autoJoinUserRoom` is off

The broadcaster still works — you just need the controller to join the room manually:

```ts
@OnConnect()
handleConnect(ctx: WsContext) {
  const userId = ctx.get<string>('userId')
  if (userId) ctx.join(`user:${userId}`)
}
```

## Scaling across instances

Without a broker, a broadcast reaches only the sockets connected to the instance that sent it. With `bootstrap({ cluster })` or a second instance behind a load balancer, users on different nodes stop seeing each other the moment the second node takes traffic. Pass a `broker` to relay broadcasts between instances:

<PmCommand add="ioredis" />

```ts
import Redis from 'ioredis'
import { WsAdapter } from '@forinda/kickjs-ws'
import { redisBroker } from '@forinda/kickjs-ws/redis'

const redis = new Redis(process.env.REDIS_URL!)

bootstrap({
  modules,
  adapters: [
    WsAdapter({
      // The subscriber must be its own connection: a Redis connection in
      // subscribe mode cannot run other commands.
      broker: redisBroker({ publisher: redis, subscriber: redis.duplicate() }),
    }),
  ],
})
```

Each instance delivers a broadcast to its own sockets straight away, then publishes it; every other instance delivers it to theirs. No socket gets a frame twice.

| Crosses instances                                    | Stays local                                    |
| ---------------------------------------------------- | ---------------------------------------------- |
| `ctx.to(room).send()`, `WS_ROOM_MANAGER.broadcast()` | `ctx.send()` — the socket is on this instance  |
| `WS_USER_BROADCASTER`, `broadcastToUser()`           | `ctx.rooms()`, `getSockets()`, `getAllRooms()` |
| `ctx.broadcast()`, `ctx.broadcastAll()`              | `getStats()` counts and room sizes             |

Things to know:

- **At-most-once.** Redis pub/sub does not store messages. An instance that is restarting or disconnected from Redis misses what was published meanwhile. Clients that must not miss events should re-fetch state on reconnect.
- **A failed publish is logged, not thrown.** Local sockets still get the broadcast; the handler keeps running.
- **One channel per app.** Instances share `kickjs:ws` by default. Give each app its own `channel` when several apps share a Redis.
- **No sticky sessions needed** for WebSockets — the connection stays on the instance that accepted it. Your load balancer must allow the upgrade.
- **Other pub/sub.** `redisBroker` accepts any client with `publish`, `subscribe`, `unsubscribe` and `on('message')`. For NATS or anything else, implement `WsBroker` (`publish`, `subscribe`, optional `close`).

See [Benchmarks → WebSockets](./benchmarks.md#websockets) for measured numbers with and without a broker.

To take connections out of Node entirely, see [Centrifugo](./centrifugo.md): clients connect to Centrifugo, and your app issues tokens and publishes through its API. `WS_USER_BROADCASTER` keeps working; `@WsController` handlers do not apply.

## Limits

Know these before you design around the adapter:

- **One process without a broker.** Rooms, `WS_ROOM_MANAGER` and `WS_USER_BROADCASTER` reach only the process holding the sockets unless you configure a [broker](#scaling-across-instances).
- **Node `bootstrap()` only.** Adapters do not run on the `@forinda/kickjs/web` entry, so there is no WebSocket support on Workers, Bun or Deno through it.
- **Coexists with other upgrade handlers.** Devtools, a GraphQL subscription server or Vite's HMR socket can share the port; the adapter ignores upgrade paths it does not own. It answers `404` only when it is the sole upgrade listener.
- **No context contributors.** A socket is not a request, so the per-request contributor chain does not run for WebSocket handlers. Resolve what a handler needs in `@OnConnect` and store it with `ctx.set()`.

## Heartbeat

The adapter sends periodic pings to detect dead connections. Clients that don't respond with a pong within the next interval are terminated. Set `heartbeatInterval: 0` to disable.

## Client Example

```js
const ws = new WebSocket('ws://localhost:3000/ws/chat')

ws.onopen = () => {
  ws.send(
    JSON.stringify({
      event: 'chat:send',
      data: { text: 'Hello!' },
    }),
  )
}

ws.onmessage = (e) => {
  const { event, data } = JSON.parse(e.data)
  console.log(event, data)
}
```
