# WebSocket Chat Example

This example demonstrates the `@forinda/kickjs-ws` package with a real-time chat app featuring rooms, namespaces, and notifications.

## What It Shows

- `@WsController` with two namespaces (`/chat` and `/notifications`)
- `@OnConnect`, `@OnDisconnect`, `@OnMessage`, `@OnError` decorators
- Room management (join, leave, broadcast to room)
- `WsContext` metadata (storing username per connection)
- `@Autowired` DI in WebSocket controllers
- Catch-all `@OnMessage('*')` for unknown events
- Multi-namespace routing

## Quick Start

```bash
cd examples/ws-api
pnpm install
kick dev
```

## WebSocket Endpoints

| Endpoint | Description |
|----------|-------------|
| `ws://localhost:3000/ws/chat` | Chat with rooms |
| `ws://localhost:3000/ws/notifications` | Pub/sub notifications |

## Chat Events

### Client → Server

| Event | Data | Description |
|-------|------|-------------|
| `chat:send` | `{ text }` | Send a message to all |
| `chat:history` | — | Request message history |
| `room:join` | `{ room }` | Join a room |
| `room:message` | `{ room, text }` | Send to a room |
| `room:leave` | `{ room }` | Leave a room |
| `user:rename` | `{ username }` | Change display name |

### Server → Client

| Event | Data | Description |
|-------|------|-------------|
| `welcome` | `{ id, username, onlineCount }` | On connect |
| `chat:message` | `{ from, text, timestamp }` | New message |
| `chat:history` | `{ messages }` | Message history |
| `user:joined` | `{ username }` | User connected |
| `user:left` | `{ username }` | User disconnected |
| `user:renamed` | `{ oldName, newName }` | User renamed |
| `room:joined` | `{ room }` | Joined a room |
| `room:message` | `{ from, text, room }` | Room message |

## Client Example

```js
const ws = new WebSocket('ws://localhost:3000/ws/chat')

ws.onmessage = (e) => {
  const { event, data } = JSON.parse(e.data)
  console.log(event, data)
}

ws.onopen = () => {
  // Send a message
  ws.send(JSON.stringify({ event: 'chat:send', data: { text: 'Hello!' } }))

  // Join a room
  ws.send(JSON.stringify({ event: 'room:join', data: { room: 'general' } }))

  // Send to room
  ws.send(JSON.stringify({
    event: 'room:message',
    data: { room: 'general', text: 'Hi room!' },
  }))
}
```

## Related Docs

- [WebSocket Guide](../guide/websockets.md)
- [DevTools Guide](../guide/devtools.md)
