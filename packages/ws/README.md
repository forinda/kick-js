# @forinda/kickjs-ws

WebSocket support with decorators, namespaces, rooms, and DI integration for KickJS.

## Install

```bash
# Using the KickJS CLI (recommended — auto-installs peer dependencies)
kick add ws

# Manual install
pnpm add @forinda/kickjs-ws ws
```

## Features

- `WsAdapter` — lifecycle adapter that attaches a WebSocket server to your app
- Decorator-driven handlers: `@WsController`, `@OnConnect`, `@OnDisconnect`, `@OnMessage`, `@OnError`
- `WsContext` — typed context for WebSocket handlers
- `RoomManager` — built-in room/namespace management

## Quick Example

```typescript
import { WsAdapter, WsController, OnConnect, OnMessage, WsContext } from '@forinda/kickjs-ws'

@WsController('/chat')
class ChatHandler {
  @OnConnect()
  onConnect(ctx: WsContext) {
    console.log('Client connected')
  }

  @OnMessage('message')
  onMessage(ctx: WsContext) {
    ctx.broadcast(ctx.data)
  }
}

// In bootstrap
bootstrap({
  modules,
  adapters: [WsAdapter()],
})
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/guide/websockets)

## License

MIT
