# Real-Time Features: SSE Streams and WebSocket Chat

*Part 4 of "Building a Task Management App with KickJS + Drizzle ORM"*

---

Vibed has two kinds of real-time features: dashboard stats that update periodically, and chat that updates instantly. We used Server-Sent Events (SSE) for the first and WebSocket for the second. This article covers when to use each and how they work with KickJS.

## When to Use What

| Feature | Protocol | Why |
|---------|----------|-----|
| Dashboard stats | SSE | Server → client only, simple, auto-reconnects |
| Activity feed | SSE | One-directional stream of events |
| Chat messages | WebSocket | Bidirectional, need client → server too |
| Typing indicators | WebSocket | Low-latency bidirectional |
| Presence (online/offline) | WebSocket | Connection-based lifecycle |

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
  const [memberResult, projectResult, taskResult, openResult, completedResult, channelResult] =
    await Promise.all([
      this.db.select({ count: sql<number>`count(*)` }).from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId)),
      this.db.select({ count: sql<number>`count(*)` }).from(projects)
        .where(eq(projects.workspaceId, workspaceId)),
      // ... more count queries
    ])

  return {
    memberCount: memberResult[0]?.count ?? 0,
    projectCount: projectResult[0]?.count ?? 0,
    // ...
  }
}
```

Six queries run in parallel via `Promise.all`. Each is a simple `COUNT(*)` with a WHERE clause — fast even on large datasets with proper indexes.

### JSON + SSE: Same Use Case, Two Endpoints

We provide both a regular JSON endpoint and an SSE stream for each stat:

```typescript
// One-shot JSON
@Get('/workspace/:workspaceId')
async workspaceStats(ctx: RequestContext) {
  const stats = await this.workspaceStatsUseCase.execute(ctx.params.workspaceId)
  ctx.json(successResponse(stats))
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

```bash
pnpm add @forinda/kickjs-ws
```

```typescript
// config/adapters.ts
const wsAdapter = WsAdapter({
  path: '/ws',
  heartbeatInterval: 30000,
  maxPayload: 1048576,  // 1MB
})
```

The WebSocket controller is loaded via a side-effect import in `adapters.ts`:

```typescript
import '@/modules/messages/presentation/chat.ws-controller'
```

This is necessary because `@WsController` decorators need to register before the adapter starts.

### Authentication at Connection Time

There's no `authBridgeMiddleware` for WebSocket — authentication happens in the `@OnConnect` handler:

```typescript
@WsController('/chat')
export class ChatWsController {
  @OnConnect()
  handleConnect(ctx: WsContext) {
    try {
      const token = ctx.data?.token || ''
      const payload = jwt.verify(token, env.JWT_SECRET) as any

      ctx.set('userId', payload.sub)
      ctx.set('email', payload.email)
      onlineUsers.set(ctx.id, { userId: payload.sub, userName: payload.email })

      ctx.send('welcome', { id: ctx.id, userId: payload.sub })
      ctx.broadcastAll('presence:online', { userId: payload.sub, userName: payload.email })
    } catch {
      ctx.send('error', { message: 'Invalid authentication token' })
    }
  }
}
```

The client sends the JWT token in the connection payload. If verification fails, we send an error but don't forcefully disconnect — the client can retry with a valid token.

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

  // Send to everyone in the room AND back to the sender
  ctx.to(`channel:${channelId}`).send('message:new', payload)
  ctx.send('message:new', payload)
}
```

Note: `ctx.to(room).send()` sends to everyone in the room EXCEPT the sender. We call `ctx.send()` separately to also notify the sender (for confirmation).

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

**Limitation**: In-memory presence doesn't work across multiple server instances. For production, move the presence map to Redis. We have a placeholder cron job (`presence-cleanup.cron.ts`) ready for this.

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
  ctx.json(successResponse(messages))
}
```

This uses cursor-based pagination (not offset-based) because chat messages are append-only and users scroll backwards through history. The cursor is a `createdAt` timestamp — the repository fetches messages older than the cursor:

```typescript
async findByChannel(channelId: string, cursor?: string, limit = 50) {
  const conditions = [eq(messages.channelId, channelId)]
  if (cursor) {
    conditions.push(lt(messages.createdAt, new Date(cursor)))
  }

  return this.db.select().from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
}
```

## Next Up

In [Part 5](/guide/tutorial-background-jobs), we'll cover background jobs — BullMQ queue processors for emails and notifications, cron jobs for overdue reminders and cleanup, and how to wire it all together with the KickJS adapter system.
