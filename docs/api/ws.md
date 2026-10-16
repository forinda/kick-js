# @forinda/kickjs-ws

Real-time controllers for KickJS. `@WsController` classes run on the lightweight [`ws`](https://github.com/websockets/ws) library (`WsAdapter`), on Socket.IO (`./socket.io`), or publish through Centrifugo (`./centrifugo`). See the [WebSocket guide](../guide/websockets.md) for the walkthrough, plus [Socket.IO](../guide/socketio.md) and [Centrifugo](../guide/centrifugo.md).

## Installation

<PmCommand add="@forinda/kickjs-ws ws" />

`socket.io` is an optional peer, needed only for `@forinda/kickjs-ws/socket.io`.

## Entry points

| Import                          | Exports                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@forinda/kickjs-ws`            | `WsAdapter`, `WsContext`, decorators, `RoomManager`, `WS_ADAPTER`, `WS_ROOM_MANAGER`, `WS_USER_BROADCASTER`, `WS_METADATA` |
| `@forinda/kickjs-ws/redis`      | `redisBroker`, `RedisBrokerOptions`, `RedisPubSubClient`                                                                   |
| `@forinda/kickjs-ws/socket.io`  | `SocketIoAdapter`, `SocketIoContext`, `SOCKET_IO`, `SocketIoAdapterOptions`                                                |
| `@forinda/kickjs-ws/centrifugo` | `CentrifugoAdapter`, `centrifugoClient`, `connectionToken`, `centrifugoConnect`, `CentrifugoApiError`, `CENTRIFUGO`        |

Types from the root: `WsAdapterOptions`, `WsAuthConfig`, `WsAuthenticatedUser`, `WsBroker`, `WsBrokerMessage`, `WsHandlerDefinition`, `WsHandlerType`, `WsUserBroadcaster`.

## Decorators

| Decorator                   | Description                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `@WsController(namespace?)` | Mark a class as a WebSocket controller (default namespace `/`); also a DI `@Service` |
| `@OnConnect()`              | Runs when a socket connects                                                          |
| `@OnDisconnect()`           | Runs when a socket disconnects                                                       |
| `@OnMessage(event)`         | Handles one event; `'*'` catches events no other handler takes                       |
| `@OnError()`                | Runs on socket errors and on messages that aren't valid JSON                         |

With `WsAdapter`, clients send and receive JSON envelopes: `{ "event": "chat:send", "data": … }`.

```ts
import { WsController, OnConnect, OnMessage, type WsContext } from '@forinda/kickjs-ws'

@WsController('/chat')
export class ChatController {
  @OnConnect()
  onConnect(ctx: WsContext) {
    ctx.join('lobby')
  }

  @OnMessage('chat:send')
  onSend(ctx: WsContext) {
    ctx.to('lobby').send('chat:receive', ctx.data)
  }
}
```

## WsAdapter

```ts
interface WsAdapterOptions {
  path?: string // upgrade base path, default '/ws'
  heartbeatInterval?: number // ping interval ms, default 30000; 0 disables
  maxPayload?: number // max message size in bytes
  auth?: WsAuthConfig
  broker?: WsBroker // relay broadcasts between instances
}
```

### auth (`WsAuthConfig`)

| Field              | Type                                                                                                                | Default   | Notes                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------- |
| `resolveUser`      | `(request: IncomingMessage, handshakeAuth?) => WsAuthenticatedUser \| null \| Promise<WsAuthenticatedUser \| null>` | required  | Runs once per socket before `@OnConnect`. `null` / throw closes with `4401` |
| `autoJoinUserRoom` | `boolean`                                                                                                           | `true`    | Join `user:<id>` once resolved                                              |
| `userRoomPrefix`   | `string`                                                                                                            | `'user:'` |                                                                             |

The resolved user is stored on the context: `ctx.get('user')`, `ctx.get('userId')`. `handshakeAuth` is passed by `SocketIoAdapter` only.

### broker

Without a broker, rooms, namespace broadcasts and per-user sends reach sockets in this process only. Use the Redis broker or implement `WsBroker` (`publish`, `subscribe`, optional `close`):

```ts
import Redis from 'ioredis'
import { redisBroker } from '@forinda/kickjs-ws/redis'

const redis = new Redis()
WsAdapter({ broker: redisBroker({ publisher: redis, subscriber: redis.duplicate() }) })
// channel defaults to 'kickjs:ws'; the connections stay yours to close
```

## WsContext

| Member                       | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `id`                         | Connection id                                                 |
| `namespace`                  | The controller's namespace                                    |
| `event` / `data`             | Event name and parsed payload (`@OnMessage` handlers)         |
| `request`                    | The HTTP upgrade request (headers, query, IP)                 |
| `cookies`                    | Parsed `Cookie` header                                        |
| `socket` / `server`          | Raw `ws` `WebSocket` and `WebSocketServer`                    |
| `get(key)` / `set(key, v)`   | Per-connection values                                         |
| `send(event, data)`          | Send to this socket                                           |
| `broadcast(event, data)`     | Everyone in the namespace except this socket                  |
| `broadcastAll(event, data)`  | Everyone in the namespace                                     |
| `join(room)` / `leave(room)` | Room membership; `ws` room names are global across namespaces |
| `rooms()`                    | Rooms this socket is in                                       |
| `to(room).send(event, data)` | Send to every socket in a room                                |

`SocketIoContext` has the same members, with Socket.IO's `Socket` / `Server` — and its rooms belong to the namespace.

## DI tokens

| Token                 | Resolves to                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `WS_ROOM_MANAGER`     | `RoomManager` — `join`, `leave`, `leaveAll`, `getRooms`, `getSockets`, `getAllRooms`, `broadcast(room, event, data, excludeId?)` |
| `WS_USER_BROADCASTER` | `WsUserBroadcaster` — `toUser(id).send(event, data)`, `broadcastToUser(id, event, data)`, `roomFor(id)`                          |
| `WS_ADAPTER`          | `{ getStats(), userRoom(id), broadcastToUser(id, event, data), …counters }`                                                      |

```ts
@Service()
export class NotificationService {
  @Inject(WS_USER_BROADCASTER) private ws!: WsUserBroadcaster

  notify(userId: string, payload: unknown) {
    this.ws.broadcastToUser(userId, 'notification', payload)
  }
}
```

## Socket.IO

```ts
import { SocketIoAdapter } from '@forinda/kickjs-ws/socket.io'

bootstrap({ modules, adapters: [SocketIoAdapter({ cors: { origin: 'https://app.example.com' } })] })
```

`SocketIoAdapterOptions` is Socket.IO's `Partial<ServerOptions>` plus `auth?: WsAuthConfig` (rejections reach the client as `connect_error` `Unauthorized`). The same `@WsController` classes run unchanged; scale with a Socket.IO adapter (`@socket.io/redis-adapter`) rather than a `WsBroker`. `SOCKET_IO` resolves the `Server`.

## Centrifugo

```ts
import { CentrifugoAdapter, connectionToken } from '@forinda/kickjs-ws/centrifugo'

CentrifugoAdapter({ url: 'http://centrifugo:8000', apiKey: getEnv('CENTRIFUGO_API_KEY') })
const token = connectionToken({
  secret: getEnv('CENTRIFUGO_SECRET'),
  sub: user.id,
  expiresInSeconds: 3600,
})
```

| Export                                    | Description                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `CentrifugoAdapter(options)`              | Registers `CENTRIFUGO` and a `WS_USER_BROADCASTER` that publishes to the user's personal channel |
| `centrifugoClient(options)`               | Server API client: `publish`, `broadcast`, `subscribe`, `disconnect`                             |
| `connectionToken(options)`                | HS256 connection JWT (`secret`, `sub`, `expiresInSeconds?`, `info?`, `channels?`)                |
| `centrifugoConnect(request, resolveUser)` | Answer Centrifugo's connect proxy with a `resolveUser` function                                  |
| `CentrifugoApiError`                      | Thrown on a non-2xx or an `error` reply                                                          |

Options: `url`, `apiKey`, `fetch?`, `timeoutMs?` (default 10 000), and on the adapter `personalChannelNamespace?`.

## Related

- [WebSocket guide](../guide/websockets.md), [Socket.IO](../guide/socketio.md), [Centrifugo](../guide/centrifugo.md)
- [Real-time tutorial](../guide/tutorial-realtime.md)
- [DevTools](../guide/devtools.md) — live WebSocket metrics
- [@forinda/kickjs — HTTP](./http.md) — the server `WsAdapter` attaches to
- [@forinda/kickjs-di](./di.md) — the DI container behind the tokens
