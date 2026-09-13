# @forinda/kickjs-ws

WebSocket adapter for KickJS — decorator-driven handlers (`@WsController`, `@OnConnect`, `@OnDisconnect`, `@OnMessage`, `@OnError`), namespaces, rooms, heartbeat, optional auth resolver.

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

## Limits

Runs under Node `bootstrap()`, not the `@forinda/kickjs/web` edge entry
(Workers, Bun, Deno). Rooms and broadcasts reach sockets in one process unless
you pass a `broker`:

```ts
import { redisBroker } from '@forinda/kickjs-ws/redis'

WsAdapter({ broker: redisBroker({ publisher: redis, subscriber: redis.duplicate() }) })
```

## Socket.IO

The same controllers run on Socket.IO (install `socket.io`):

```ts
import { SocketIoAdapter } from '@forinda/kickjs-ws/socket.io'

bootstrap({ modules, adapters: [SocketIoAdapter({ cors: { origin: 'https://app.example.com' } })] })
```

Rooms are per namespace there, and `WS_ROOM_MANAGER` is replaced by the `SOCKET_IO` token.
See [kickjs.app/guide/socketio](https://kickjs.app/guide/socketio).

## Documentation

[kickjs.app/guide/websockets](https://kickjs.app/guide/websockets)

## License

MIT
