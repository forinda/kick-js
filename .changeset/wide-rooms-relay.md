---
'@forinda/kickjs-ws': minor
---

Broadcasts can now reach sockets on every instance, not only the one that sent
them. Pass a `broker` to `WsAdapter`; `@forinda/kickjs-ws/redis` ships one over
Redis pub/sub.

```ts
import Redis from 'ioredis'
import { WsAdapter } from '@forinda/kickjs-ws'
import { redisBroker } from '@forinda/kickjs-ws/redis'

const redis = new Redis(process.env.REDIS_URL!)

WsAdapter({ broker: redisBroker({ publisher: redis, subscriber: redis.duplicate() }) })
```

Room broadcasts (`ctx.to()`, `WS_ROOM_MANAGER.broadcast`), per-user sends
(`WS_USER_BROADCASTER`, `broadcastToUser`) and namespace broadcasts
(`ctx.broadcast`, `ctx.broadcastAll`) are delivered to local sockets straight
away, then published; other instances deliver them to theirs, and each
instance skips its own messages so no socket gets a frame twice. A failed
publish is logged and never thrown into the handler. Membership queries
(`getStats().rooms`, `getSockets`, `getAllRooms`) still describe the local
instance.

The Redis subpath types the client by shape, so `ioredis` is not a dependency
of the package — any client with `publish` / `subscribe` / `on('message')`
works, and `WsBroker` can be implemented over another pub/sub. Without a
`broker` nothing changes.
