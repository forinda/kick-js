# @forinda/kickjs-ws

Realtime for KickJS — decorator-driven handlers (`@WsController`, `@OnConnect`, `@OnDisconnect`, `@OnMessage`, `@OnError`), namespaces, rooms, heartbeat and an auth hook, on the transport you pick.

| Import                          | What it gives you                                             | Needs                         |
| ------------------------------- | ------------------------------------------------------------- | ----------------------------- |
| `@forinda/kickjs-ws`            | `WsAdapter` — raw WebSockets on `ws`                          | `ws`                          |
| `@forinda/kickjs-ws/redis`      | `redisBroker` — relay `WsAdapter` broadcasts across instances | a Redis client (e.g. ioredis) |
| `@forinda/kickjs-ws/socket.io`  | `SocketIoAdapter` — the same controllers over Socket.IO       | `socket.io`                   |
| `@forinda/kickjs-ws/centrifugo` | `CentrifugoAdapter` — publish through a Centrifugo server     | a Centrifugo server           |

## Install

```bash
kick add ws
```

## Quick Example

```ts
// chat.ws-controller.ts
import { WsController, OnConnect, OnMessage, WsContext } from '@forinda/kickjs-ws'

@WsController('/chat')
export class ChatController {
  @OnConnect()
  onConnect(ctx: WsContext) {
    ctx.send('welcome', { id: ctx.id })
  }

  @OnMessage('say')
  onSay(ctx: WsContext) {
    ctx.broadcast('say', ctx.data)
  }
}
```

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import { WsAdapter } from '@forinda/kickjs-ws'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [WsAdapter({ path: '/ws' })],
})
```

Clients connect to `ws://localhost:3000/ws/chat`.

## More than one instance

Rooms and broadcasts reach sockets in one process unless you pass a `broker`:

```ts
import Redis from 'ioredis'
import { getEnv } from '@forinda/kickjs'
import { WsAdapter } from '@forinda/kickjs-ws'
import { redisBroker } from '@forinda/kickjs-ws/redis'

const redis = new Redis(getEnv('REDIS_URL'))

WsAdapter({ broker: redisBroker({ publisher: redis, subscriber: redis.duplicate() }) })
```

## Socket.IO

The same controllers run on Socket.IO:

```ts
import { SocketIoAdapter } from '@forinda/kickjs-ws/socket.io'

bootstrap({ modules, adapters: [SocketIoAdapter({ cors: { origin: 'https://app.example.com' } })] })
```

Rooms are per namespace, `WS_ROOM_MANAGER` is replaced by the `SOCKET_IO` token, and it scales with Socket.IO's own adapters (`@socket.io/redis-adapter`).

## Centrifugo

Centrifugo holds the connections; KickJS signs connection tokens, answers its connect proxy, and publishes:

```ts
import { bootstrap, getEnv } from '@forinda/kickjs'
import { CentrifugoAdapter } from '@forinda/kickjs-ws/centrifugo'

bootstrap({
  modules,
  adapters: [
    CentrifugoAdapter({ url: getEnv('CENTRIFUGO_URL'), apiKey: getEnv('CENTRIFUGO_API_KEY') }),
  ],
})
```

Services inject `CENTRIFUGO` to publish. `@WsController` classes do not apply — the sockets are not in Node.

## Common to all

- `WS_USER_BROADCASTER` is registered by every adapter, so `broadcastToUser(userId, event, data)` works unchanged when you switch transports.
- Adapters run under Node `bootstrap()`, not the `@forinda/kickjs/web` edge entry (Workers, Bun, Deno).

## Documentation

- [WebSockets](https://kickjs.app/guide/websockets)
- [Socket.IO](https://kickjs.app/guide/socketio)
- [Centrifugo](https://kickjs.app/guide/centrifugo)

## License

MIT
