# WebSocket Support

KickJS provides decorator-driven WebSocket support with namespaces, rooms, and full DI integration. Built on the lightweight `ws` library.

## Setup

```ts
import { bootstrap } from '@forinda/kickjs'
import { WsAdapter } from '@forinda/kickjs-ws'

bootstrap({
  modules: [ChatModule],
  adapters: [
    new WsAdapter({ path: '/ws' }),
  ],
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

| Property/Method | Description |
|----------------|-------------|
| `ctx.id` | Unique connection ID |
| `ctx.data` | Parsed message payload |
| `ctx.event` | Event name from the message |
| `ctx.namespace` | Namespace path |
| `ctx.socket` | Raw WebSocket instance |
| `ctx.get(key)` | Get metadata value |
| `ctx.set(key, value)` | Set metadata (persists for connection lifetime) |
| `ctx.send(event, data)` | Send to this client |
| `ctx.broadcast(event, data)` | Send to all clients in namespace except sender |
| `ctx.broadcastAll(event, data)` | Send to all clients in namespace including sender |
| `ctx.join(room)` | Join a room |
| `ctx.leave(room)` | Leave a room |
| `ctx.rooms()` | Get rooms this client is in |
| `ctx.to(room).send(event, data)` | Send to all clients in a room |

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

## Multiple Namespaces

Each `@WsController` creates a separate namespace:

```ts
@WsController('/chat')
export class ChatController { /* ... */ }

@WsController('/notifications')
export class NotificationController { /* ... */ }
```

- `ws://localhost:3000/ws/chat` → ChatController
- `ws://localhost:3000/ws/notifications` → NotificationController

## Configuration

```ts
new WsAdapter({
  path: '/ws',              // Base path (default: '/ws')
  heartbeatInterval: 30000, // Ping interval in ms (default: 30000, 0 to disable)
  maxPayload: 1048576,      // Max message size in bytes
})
```

## Heartbeat

The adapter sends periodic pings to detect dead connections. Clients that don't respond with a pong within the next interval are terminated. Set `heartbeatInterval: 0` to disable.

## Client Example

```js
const ws = new WebSocket('ws://localhost:3000/ws/chat')

ws.onopen = () => {
  ws.send(JSON.stringify({
    event: 'chat:send',
    data: { text: 'Hello!' },
  }))
}

ws.onmessage = (e) => {
  const { event, data } = JSON.parse(e.data)
  console.log(event, data)
}
```
