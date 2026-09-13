---
'@forinda/kickjs-ws': patch
'@forinda/kickjs': patch
---

Fix WsAdapter breaking other upgrade handlers, dropping early messages, and
never counting sent frames.

Found by running the adapter against a real server — its only tests covered
`RoomManager`, and a note claimed real-server tests could not run under
vitest's worker threads. They can, and a suite now does.

**It destroyed other listeners' sockets.** Node calls every `'upgrade'`
listener, and WsAdapter answered `404` and destroyed any upgrade on a path it
did not own. On a shared server that killed the devtools bus, a GraphQL
subscription server, or Vite's HMR socket in dev. It now leaves unknown paths
to other listeners, and answers `404` only when it is the sole listener.

**Messages sent before `auth.resolveUser` settled were dropped.** A client
typically sends as soon as the socket opens, which is before an async resolver
returns; the code comment said those messages were buffered, and they were
discarded. They are now held and delivered after `@OnConnect`, in order. The
hold is capped at 64 messages and 1 MiB — the sender is not authenticated yet,
so an unbounded queue would let anyone buffer memory on the server — and a
socket that exceeds either is closed with `1008`. A socket that closes while
the resolver runs no longer reaches `@OnConnect` or re-joins its user room after
the close handler cleaned it up. An `async` `@OnConnect` is now awaited before
any message reaches `@OnMessage`, with or without `auth`; messages that arrive
meanwhile are held under the same limits.

**`messagesSent` was always 0.** Declared, exposed through `getStats()` and
shown in devtools, never incremented. `WsContext` and `RoomManager` now report
every frame they write.

**Documentation described a different adapter in places:**

- the README quick start read `ctx.socketId`, which does not exist — it is `ctx.id`
- `WsAuthConfig.resolveUser` said a rejection answers HTTP 401; the socket is
  accepted and closed with `4401`, which is what the guide already said
- the authenticated user is stored as `user` and `userId`, not `user:<field>` keys
- `autoJoinUserRoom` read as opt-in; it defaults to on
- `WS_USER_BROADCASTER` is registered always, not only when `auth` is set

**Limits are now written down**, in the README and a new guide section: one
process (rooms and per-user broadcasts do not cross instances, so a second node
is a second island), Node `bootstrap()` only (no WebSocket support on the edge
entry), and no context contributors for socket handlers — which the kickjs
README and the contributor guide both claimed.

Room names stay shared across namespaces, and that is now documented rather
than changed. Service broadcasts through `WS_ROOM_MANAGER` and `user:<id>`
rooms depend on one keyspace; scoping names per namespace would have broken
both silently.
