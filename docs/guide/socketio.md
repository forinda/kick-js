# Socket.IO Integration

`SocketIoAdapter` serves your `@WsController` classes over [Socket.IO](https://socket.io) instead of raw WebSockets. The decorators are the same; the transport brings client reconnection, a long-polling fallback, and Socket.IO's own adapters for running more than one instance.

## Setup

<PmCommand add="@forinda/kickjs-ws socket.io" />

```ts
import { bootstrap } from '@forinda/kickjs'
import { SocketIoAdapter } from '@forinda/kickjs-ws/socket.io'
import { modules } from './modules'

bootstrap({
  modules,
  adapters: [
    SocketIoAdapter({
      // Any Socket.IO server option: cors, path, pingInterval, adapter, …
      cors: { origin: 'http://localhost:5173', credentials: true },
    }),
  ],
})
```

Use `SocketIoAdapter` **instead of** `WsAdapter`, not alongside it — both would serve the same controllers.

## Controllers

```ts
import { WsController, OnConnect, OnDisconnect, OnMessage } from '@forinda/kickjs-ws'
import type { SocketIoContext } from '@forinda/kickjs-ws/socket.io'

@WsController('/chat')
export class ChatController {
  @OnConnect()
  connect(ctx: SocketIoContext) {
    ctx.join('general')
  }

  @OnMessage('message')
  message(ctx: SocketIoContext) {
    ctx.to('general').send('message', { from: ctx.id, text: ctx.data.text })
  }

  @OnMessage('*')
  unknown(ctx: SocketIoContext) {
    ctx.send('error', { message: `Unknown event: ${ctx.event}` })
  }

  @OnDisconnect()
  disconnect(ctx: SocketIoContext) {}
}
```

How the pieces map:

| KickJS                                   | Socket.IO                                                      |
| ---------------------------------------- | -------------------------------------------------------------- |
| `@WsController('/chat')`                 | `io.of('/chat')` — `@WsController()` is the main namespace `/` |
| `@OnMessage('message')`                  | the client's `socket.emit('message', data)`                    |
| `@OnMessage('*')`                        | any event no other handler claims                              |
| `ctx.send(event, data)`                  | `socket.emit`                                                  |
| `ctx.broadcast(event, data)`             | `socket.broadcast.emit` — the namespace, sender excluded       |
| `ctx.broadcastAll(event, data)`          | `socket.nsp.emit` — the namespace, sender included             |
| `ctx.join(room)` / `ctx.to(room).send()` | `socket.join` / `socket.nsp.to(room).emit` — sender included   |
| `ctx.socket` / `ctx.server`              | the Socket.IO `Socket` / `Server`, for anything not mapped     |

`SocketIoContext` mirrors `WsContext` (`id`, `data`, `event`, `namespace`, `request`, `cookies`, `get`/`set`, `rooms()`), so a controller written for one runs on the other — with the differences below.

::: warning Differences from `WsAdapter`

- **Rooms belong to a namespace.** With `ws`, `lobby` joined from `/chat` and from `/admin` is one room; with Socket.IO they are two.
- **No `WS_ROOM_MANAGER`.** Socket.IO keeps its own rooms — inject `SOCKET_IO` to reach them from a service.
- **Acknowledgements are not mapped.** A client callback arrives as an extra argument the handler does not see; use `ctx.socket.on(...)` for events that need one.

:::

As with `WsAdapter`, an `async` `@OnConnect` is awaited: events that arrive meanwhile are held (up to 64, then the socket is disconnected) and delivered once it settles.

## Authentication

`auth` takes the same `resolveUser` hook as `WsAdapter`, run as namespace middleware before the connection is accepted:

```ts
SocketIoAdapter({
  auth: {
    resolveUser: async (request) => {
      const token = parseCookie(request.headers.cookie).sid
      return token ? await sessions.verify(token) : null
    },
  },
})
```

- Returning `null` or throwing rejects the connection; the client gets `connect_error` with `err.message === 'Unauthorized'`.
- The user is available as `ctx.get('user')` and `ctx.get('userId')`.
- Each authenticated socket joins `user:<id>` in its namespace (`autoJoinUserRoom: false` to opt out, `userRoomPrefix` to rename).

`resolveUser` receives the handshake request, so it reads cookies, headers and the query string. A token sent through the client's `auth` option is on `ctx.socket.handshake.auth`, not the request.

## Services

```ts
import { Service, Inject } from '@forinda/kickjs'
import { WS_USER_BROADCASTER, type WsUserBroadcaster } from '@forinda/kickjs-ws'
import { SOCKET_IO } from '@forinda/kickjs-ws/socket.io'
import type { Server } from 'socket.io'

@Service()
export class NotificationService {
  constructor(
    @Inject(WS_USER_BROADCASTER) private users: WsUserBroadcaster,
    @Inject(SOCKET_IO) private io: Server,
  ) {}

  notify(userId: string, data: unknown) {
    // Every namespace the user is connected to.
    this.users.broadcastToUser(userId, 'notification', data)
  }

  announce(data: unknown) {
    this.io.of('/chat').to('general').emit('announcement', data)
  }
}
```

`WS_USER_BROADCASTER` is the same token `WsAdapter` registers, so code written against it does not change when you switch transports.

## Running more than one instance

Pass a Socket.IO adapter. With [`@socket.io/redis-adapter`](https://socket.io/docs/v4/redis-adapter/), room emits, namespace broadcasts and `WS_USER_BROADCASTER` reach sockets on every instance:

<PmCommand add="@socket.io/redis-adapter ioredis" />

```ts
import Redis from 'ioredis'
import { createAdapter } from '@socket.io/redis-adapter'
import { SocketIoAdapter } from '@forinda/kickjs-ws/socket.io'

const pub = new Redis(process.env.REDIS_URL!)

SocketIoAdapter({ adapter: createAdapter(pub, pub.duplicate()) })
```

Unlike `WsAdapter`, Socket.IO's long-polling fallback needs **sticky sessions** at the load balancer — or `transports: ['websocket']` on the client to skip polling.

## Client

```ts
import { io } from 'socket.io-client'

const chat = io('http://localhost:3000/chat', { withCredentials: true })

chat.on('connect_error', (err) => {
  if (err.message === 'Unauthorized') redirectToLogin()
})
chat.on('message', (msg) => console.log(msg))
chat.emit('message', { text: 'Hello everyone!' })
```

## Socket.IO or ws?

|                       | `WsAdapter` (`ws`)                                           | `SocketIoAdapter`                              |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| **Client**            | Any WebSocket client, `{ event, data }` JSON                 | `socket.io-client` only                        |
| **Reconnection**      | Yours to write                                               | Built in                                       |
| **Fallback**          | WebSocket only                                               | Long-polling                                   |
| **Rooms**             | Shared across namespaces                                     | Per namespace                                  |
| **Acknowledgements**  | —                                                            | Via `ctx.socket`                               |
| **Several instances** | `broker` ([Redis](./websockets.md#scaling-across-instances)) | Socket.IO adapter (`@socket.io/redis-adapter`) |
| **Sticky sessions**   | Not needed                                                   | Needed for polling                             |
| **Decorators**        | `@WsController`, `@OnMessage`, …                             | The same                                       |

## Sharing auth with your HTTP routes

Auth is [bring-your-own](./byo-recipes.md#auth), so the piece to share is a plain function you own. Keep token verification separate from the transport, and both sides call it:

```ts
// src/auth/verify-token.ts — no HTTP, no socket, just the token
import jwt from 'jsonwebtoken'
import type { AuthUser } from './context'

export function verifyToken(token: string | undefined): AuthUser | null {
  if (!token) return null
  try {
    return mapPayload(jwt.verify(token, JWT_SECRET) as jwt.JwtPayload)
  } catch {
    return null
  }
}
```

The HTTP side calls it from the `user` contributor ([Step 3 of the recipe](./byo-recipes.md#auth)); the socket side calls it from `resolveUser`:

```ts
SocketIoAdapter({
  auth: {
    resolveUser: (request) => verifyToken(parseCookie(request.headers.cookie).token),
  },
})
```

Resist reusing a `RequestContext`-shaped strategy here by faking a request object. A handshake is not an HTTP request — it has no route, params or body — and the mock drifts the moment the strategy reads something the fake does not have.
