---
'@forinda/kickjs-ws': minor
---

`@forinda/kickjs-ws/socket.io` serves the same `@WsController` classes over
Socket.IO, so choosing a transport no longer means rewriting controllers.

```ts
import { SocketIoAdapter } from '@forinda/kickjs-ws/socket.io'

bootstrap({ modules, adapters: [SocketIoAdapter({ cors: { origin: 'https://app.example.com' } })] })
```

Namespaces map to `io.of(namespace)`, `@OnMessage('x')` handles the client's
`socket.emit('x', data)`, and `SocketIoContext` mirrors `WsContext` (`send`,
`broadcast`, `broadcastAll`, `join`, `to(room).send`, `get`/`set`, `cookies`).
`auth.resolveUser` runs as namespace middleware and rejects with a
`connect_error` of `Unauthorized`; authenticated sockets join `user:<id>`, and
`WS_USER_BROADCASTER` reaches a user in every namespace. An async `@OnConnect`
is awaited before events are delivered, as with `WsAdapter`.

Every Socket.IO server option passes through, including `adapter` — with
`@socket.io/redis-adapter`, emits and per-user sends cross instances. Shutdown
disconnects sockets and closes the engine but leaves the HTTP server to KickJS,
where `io.close()` would close it too.

`socket.io` is an optional peer dependency, needed only for this subpath.
Differences from `WsAdapter`: rooms are per namespace, `WS_ROOM_MANAGER` is not
registered (inject `SOCKET_IO`), and acknowledgements go through `ctx.socket`.
