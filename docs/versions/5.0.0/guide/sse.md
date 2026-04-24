# Server-Sent Events (SSE)

KickJS provides a built-in `ctx.sse()` helper for streaming real-time events to clients using the [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) protocol.

## Quick Start

```ts
import { Controller, Get } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'

@Controller()
class EventsController {
  @Get('/clock')
  stream(ctx: RequestContext) {
    const sse = ctx.sse()

    // Send a tick every second
    const interval = setInterval(() => {
      sse.send({ time: new Date().toISOString() }, 'tick')
    }, 1000)

    // Clean up when client disconnects
    sse.onClose(() => {
      clearInterval(interval)
    })
  }
}
```

## API

`ctx.sse()` sets the correct HTTP headers and returns an object with:

| Method | Description |
|--------|-------------|
| `send(data, event?, id?)` | Send an event. `data` is JSON-serialized. Optional `event` name and `id`. |
| `comment(text)` | Send a comment line (`:` prefix). Useful as a keep-alive ping. |
| `onClose(fn)` | Register a callback for when the client disconnects. |
| `close()` | End the stream from the server side. |

## Headers

`ctx.sse()` automatically sets:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

The `X-Accel-Buffering: no` header disables Nginx buffering so events are delivered immediately.

## Client Usage

```js
const source = new EventSource('/api/v1/events/clock')

source.addEventListener('tick', (event) => {
  const data = JSON.parse(event.data)
  console.log('Server time:', data.time)
})

source.onerror = () => {
  console.log('Connection lost, reconnecting...')
}
```

## Patterns

### Sending named events

```ts
sse.send({ userId: 1, action: 'login' }, 'user-activity')
sse.send({ count: 42 }, 'metrics-update')
```

The client listens with `addEventListener('user-activity', ...)`.

### Keep-alive with comments

```ts
const keepAlive = setInterval(() => {
  sse.comment('ping')
}, 30_000)

sse.onClose(() => clearInterval(keepAlive))
```

### Event IDs for resumption

```ts
let eventId = 0

const interval = setInterval(() => {
  eventId++
  sse.send({ message: 'update' }, 'change', String(eventId))
}, 5000)
```

The client sends `Last-Event-ID` on reconnection, allowing you to replay missed events.

### Reactive SSE with KickJS reactivity

```ts
import { ref, watch } from '@forinda/kickjs'

const notifications = ref<string[]>([])

@Controller()
class NotificationController {
  @Get('/notifications')
  stream(ctx: RequestContext) {
    const sse = ctx.sse()

    const stop = watch(notifications, (items) => {
      sse.send({ notifications: items }, 'update')
    })

    sse.onClose(() => stop())
  }
}
```

## When to use SSE vs WebSocket

| Feature | SSE | WebSocket |
|---------|-----|-----------|
| Direction | Server → Client only | Bidirectional |
| Protocol | HTTP | WS (upgrade) |
| Reconnection | Built-in (`EventSource`) | Manual |
| Binary data | No (text only) | Yes |
| Complexity | Simple | More setup |

Use SSE for notifications, live feeds, progress updates. Use WebSocket for chat, gaming, or when the client needs to send data back.

## Related

- [WebSockets](./websockets.md) — bidirectional real-time communication
- [Reactivity](./reactivity.md) — reactive state that pairs well with SSE
- [DevTools](./devtools.md) — reactive metrics and health endpoints
