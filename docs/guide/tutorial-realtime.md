# Real-Time Features: SSE Streams and WebSocket Chat

_Part 4 of "Building a Task Management App with KickJS"_

---

Vibed has two kinds of real-time features: dashboard stats that update periodically, and chat that updates instantly. We used Server-Sent Events (SSE) for the first and WebSocket for the second. This article covers when to use each and how they work with KickJS.

## When to Use What

| Feature                   | Protocol  | Why                                           |
| ------------------------- | --------- | --------------------------------------------- |
| Dashboard stats           | SSE       | Server → client only, simple, auto-reconnects |
| Activity feed             | SSE       | One-directional stream of events              |
| Chat messages             | WebSocket | Bidirectional, need client → server too       |
| Typing indicators         | WebSocket | Low-latency bidirectional                     |
| Presence (online/offline) | WebSocket | Connection-based lifecycle                    |

**Rule of thumb**: If the client only needs to receive data, use SSE. If the client needs to send data too, use WebSocket.

## SSE: Stats Dashboard

SSE is built into KickJS's `RequestContext`. No packages to install, no adapters to configure.

### The Endpoint

```typescript
@Get('/workspace/:workspaceId/stream')
@ApiTags('Stats')
async workspaceStatsStream(ctx: RequestContext) {
  const { workspaceId } = ctx.params
  const sse = ctx.sse()

  const sendStats = async () => {
    const stats = await this.workspaceStatsUseCase.execute(workspaceId)
    sse.send(stats, 'workspace:stats')
  }

  // Send immediately, then every 10 seconds
  await sendStats()
  const interval = setInterval(sendStats, 10000)
  sse.onClose(() => clearInterval(interval))
}
```

`ctx.sse()` returns four methods:

- `send(data, event?, id?)` — send an event to the client
- `comment(text)` — send a keep-alive comment
- `onClose(fn)` — cleanup when the client disconnects
- `close()` — end the stream from the server side

### The Critical Rule: Always Clean Up

If you forget `sse.onClose()`, the interval keeps running after the client disconnects. With enough connections and disconnections, you'll leak memory and hammer the database with queries that nobody reads.

```typescript
// ALWAYS do this
sse.onClose(() => clearInterval(interval))
```

### The Stats Repository

The stats aren't stored — they're computed on the fly from aggregate queries:

```typescript
async getWorkspaceStats(workspaceId: string) {
  const [memberCount, projectCount, taskCount, openCount, completedCount, channelCount] =
    await Promise.all([
      this.memberRepo.countByWorkspace(workspaceId),
      this.projectRepo.countByWorkspace(workspaceId),
      // ... more count queries, each behind a repository method
    ])

  return {
    memberCount,
    projectCount,
    // ...
  }
}
```

Six counts run in parallel via `Promise.all`. Each is a simple count behind a repository method — fast even on large datasets with proper indexes.

### JSON + SSE: Same Use Case, Two Endpoints

We provide both a regular JSON endpoint and an SSE stream for each stat:

```typescript
// One-shot JSON
@Get('/workspace/:workspaceId')
async workspaceStats(ctx: RequestContext) {
  return this.workspaceStatsUseCase.execute(ctx.params.workspaceId)
}

// Live SSE stream
@Get('/workspace/:workspaceId/stream')
async workspaceStatsStream(ctx: RequestContext) {
  // ... SSE implementation
}
```

The JSON endpoint is for initial page loads. The SSE stream is for live updates while the dashboard is open.

## WebSocket: Chat

WebSocket requires the `@forinda/kickjs-ws` package and a `WsAdapter`.

### Setup

<PmCommand add="@forinda/kickjs-ws" />

```typescript
// src/config/adapters.ts
import jwt from 'jsonwebtoken'
import { getEnv } from '@forinda/kickjs'
import { WsAdapter } from '@forinda/kickjs-ws'

const wsAdapter = WsAdapter({
  path: '/ws',
  heartbeatInterval: 30000,
  maxPayload: 1048576, // 1MB
  auth: {
    // Runs once per socket at upgrade time, before any @OnConnect handler
    resolveUser: (request) => {
      const token = new URL(request.url ?? '', 'http://localhost').searchParams.get('token')
      if (!token) return null // socket closes with 4401
      const payload = jwt.verify(token, getEnv('JWT_SECRET')) as { sub: string; email: string }
      return { id: payload.sub, email: payload.email }
    },
  },
})
```

The WebSocket controller is loaded via a side-effect import in `adapters.ts`:

```typescript
import '@/modules/messages/chat.ws-controller'
```

This is necessary because `@WsController` decorators need to register before the adapter starts.

### Authentication at Connection Time

HTTP middleware doesn't run for WebSocket upgrades — authentication happens in the adapter's `auth.resolveUser` hook (above). It stores the user on the context as `user`, and its `id` as `userId`, before `@OnConnect` fires:

```typescript
@WsController('/chat')
export class ChatWsController {
  @OnConnect()
  handleConnect(ctx: WsContext) {
    const user = ctx.get<{ id: string; email: string }>('user')!
    onlineUsers.set(ctx.id, { userId: user.id, userName: user.email })

    ctx.send('welcome', { id: ctx.id, userId: user.id })
    ctx.broadcastAll('presence:online', { userId: user.id, userName: user.email })
  }
}
```

The client sends the JWT in the connection URL (`ws://host/ws/chat?token=…`) — browsers can't set headers on a WebSocket. If `resolveUser` returns `null` or throws, the socket closes with code `4401` and `@OnConnect` never runs, so the client reconnects with a valid token. See [WebSockets → Authenticated Handshake](./websockets.md#authenticated-handshake).

### Rooms for Channel Isolation

Chat messages are scoped to channels. We use rooms (a Socket.IO concept) to ensure messages only reach users who've joined that channel:

```typescript
@OnMessage('channel:join')
handleJoin(ctx: WsContext) {
  const channelId = ctx.data?.channelId
  if (!channelId) return
  ctx.join(`channel:${channelId}`)
  ctx.to(`channel:${channelId}`).send('channel:user_joined', {
    channelId,
    userId: ctx.get('userId'),
  })
}
```

When a message is sent, it goes to everyone in the room:

```typescript
@OnMessage('message:send')
async handleSend(ctx: WsContext) {
  const userId = ctx.get('userId')
  if (!userId) return ctx.send('error', { message: 'Not authenticated' })

  const { channelId, content } = ctx.data || {}
  if (!channelId || !content) return

  // Persist to database
  const message = await this.messageRepo.create({
    channelId, senderId: userId, content, mentions: [],
  })

  const payload = {
    messageId: message.id,
    channelId,
    senderId: userId,
    content: message.content,
    createdAt: message.createdAt,
  }

  // Send to everyone in the room — the sender included, since it joined the channel
  ctx.to(`channel:${channelId}`).send('message:new', payload)
}
```

Note: `ctx.to(room).send()` sends to every socket in the room, the sender included. Use `ctx.broadcast()` when the sender should be left out.

### Typing Indicators

Typing indicators are fire-and-forget — no database persistence:

```typescript
@OnMessage('channel:typing')
handleTyping(ctx: WsContext) {
  const { channelId } = ctx.data || {}
  if (!channelId) return
  const info = onlineUsers.get(ctx.id)
  ctx.to(`channel:${channelId}`).send('channel:typing', {
    channelId,
    userId: ctx.get('userId'),
    userName: info?.userName,
  })
}
```

### Presence Tracking

We use an in-memory `Map<socketId, { userId, userName }>` for presence. On connect, add the user. On disconnect, remove and broadcast:

```typescript
const onlineUsers = new Map<string, { userId: string; userName: string }>()

@OnDisconnect()
handleDisconnect(ctx: WsContext) {
  const info = onlineUsers.get(ctx.id)
  if (info) {
    ctx.broadcastAll('presence:offline', { userId: info.userId })
    onlineUsers.delete(ctx.id)
  }
}
```

**Limitation**: In-memory presence doesn't work across multiple server instances. For production, move the presence map to Redis. (Broadcasts themselves can cross instances with `WsAdapter({ broker: redisBroker(...) })` — see [Scaling across instances](./websockets.md#scaling-across-instances).) We have a placeholder cron job (`presence-cleanup.cron.ts`) ready for this.

### Message Edit and Delete

Edits and deletes verify ownership before proceeding:

```typescript
@OnMessage('message:edit')
async handleEdit(ctx: WsContext) {
  const userId = ctx.get('userId')
  if (!userId) return

  const { messageId, content } = ctx.data || {}
  if (!messageId || !content) return

  const message = await this.messageRepo.findById(messageId)
  if (!message || message.senderId !== userId) return  // ownership check

  const updated = await this.messageRepo.update(messageId, { content })
  ctx.to(`channel:${message.channelId}`).send('message:edited', {
    messageId, channelId: message.channelId, content, updatedAt: updated.updatedAt,
  })
}
```

The `update` method in the repository automatically sets `isEdited: true` on the message.

## HTTP Fallback for Messages

WebSocket handles real-time delivery, but we also have REST endpoints for message history:

```typescript
// Cursor-based pagination for chat history
@Get('/channel/:channelId')
async listByChannel(ctx: RequestContext) {
  const messages = await this.listMessagesUseCase.execute(
    ctx.params.channelId,
    ctx.query.cursor as string | undefined,
    ctx.query.limit ? Number(ctx.query.limit) : undefined,
  )
  return messages
}
```

This uses cursor-based pagination (not offset-based) because chat messages are append-only and users scroll backwards through history. (`ctx.paginateCursor()` now does this generically, with an opaque cursor and `links.next` — see [Cursor pagination](./query-parsing.md#cursor-pagination).) The cursor is a `createdAt` timestamp — the repository fetches messages older than the cursor, newest first:

```typescript
async findByChannel(channelId: string, cursor?: string, limit = 50) {
  // The repository owns the "messages in this channel older than `cursor`,
  // newest first" query — the controller stays storage-agnostic.
  return this.messageRepo.findByChannelBefore(channelId, cursor, limit)
}
```

## Next Up

In [Part 5](./tutorial-background-jobs.md), we'll cover background jobs — BullMQ queue processors for emails and notifications, cron jobs for overdue reminders and cleanup, and how to wire it all together with the KickJS adapter system.
