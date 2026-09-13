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

Runs in **one Node process** under `bootstrap()`. Rooms and per-user broadcasts
reach sockets in that process only, so a second instance is a second island. It
does not run on the `@forinda/kickjs/web` edge entry (Workers, Bun, Deno).

## Documentation

[kickjs.app/guide/websockets](https://kickjs.app/guide/websockets)

## License

MIT
