# @forinda/kickjs-ws

Realtime for KickJS: decorator-driven handlers (`@WsController`, `@OnConnect`, `@OnMessage`, …), namespaces, rooms, heartbeat and an auth hook. Runs on raw WebSockets (`ws`), Socket.IO or Centrifugo, with a Redis broker for several instances.

## Install

```bash
kick add ws
```

## Quick example

```ts
import { bootstrap } from '@forinda/kickjs'
import { OnConnect, OnMessage, WsAdapter, WsController, type WsContext } from '@forinda/kickjs-ws'

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

export const app = await bootstrap({ modules, adapters: [WsAdapter({ path: '/ws' })] })
```

Clients connect to `ws://localhost:3000/ws/chat`.

## Documentation

- [WebSockets](https://kickjs.app/guide/websockets): rooms, auth, scaling with `@forinda/kickjs-ws/redis`
- [Socket.IO](https://kickjs.app/guide/socketio) (`@forinda/kickjs-ws/socket.io`)
- [Centrifugo](https://kickjs.app/guide/centrifugo) (`@forinda/kickjs-ws/centrifugo`)

## License

MIT
