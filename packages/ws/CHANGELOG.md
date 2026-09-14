# @forinda/kickjs-ws

## 7.1.1

### Patch Changes

- [#703](https://github.com/forinda/kick-js/pull/703) [`fdf0db8`](https://github.com/forinda/kick-js/commit/fdf0db841242760566639dae06e50ae90d61ffe5) Thanks [@forinda](https://github.com/forinda)! - WebSocket connections no longer answer 503 after a dev hot reload.
  
  On reload, `bootstrap()` shuts the old app down with `closeServer: false` and
  starts a fresh one on the same HTTP server. `WsAdapter.shutdown()` closed its
  `WebSocketServer` but left its `'upgrade'` listener on the server. That listener
  ran before the new adapter's, matched the path, and handed the upgrade to the
  closed server — which `ws` answers with 503 — so every WebSocket failed until the
  dev server was restarted, and each save added another dead listener.
  `shutdown()` now removes the listener.
  
  `SocketIoAdapter` had the same shape: engine.io's `attach()` adds upgrade, close
  and listening listeners and wraps the server's own request listeners, and
  shutdown undid none of it. It now removes what `attach()` added and restores the
  request listeners it wrapped, so a reload leaves the server as it found it.

## 7.1.0

### Minor Changes

- [#693](https://github.com/forinda/kick-js/pull/693) [`faf5cd9`](https://github.com/forinda/kick-js/commit/faf5cd9ccae9a892ebf9677c44755116cee06ff9) Thanks [@forinda](https://github.com/forinda)! - `@forinda/kickjs-ws/socket.io` serves the same `@WsController` classes over
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

- [#694](https://github.com/forinda/kick-js/pull/694) [`705a211`](https://github.com/forinda/kick-js/commit/705a21171725985a3f583ff3fc3d86e054068b1f) Thanks [@forinda](https://github.com/forinda)! - Add `@forinda/kickjs-ws/centrifugo` for apps that hand client connections to
  [Centrifugo](https://centrifugal.dev) instead of holding them in Node.
  
  - `centrifugoClient({ url, apiKey })` — `publish`, `broadcast`, `subscribe`,
    `disconnect` over Centrifugo's server API. Throws `CentrifugoApiError` on a
    non-2xx reply or on the `error` object Centrifugo returns with HTTP 200.
  - `connectionToken({ secret, sub, expiresInSeconds, info, channels })` — an
    HS256 connection JWT signed with `node:crypto`; no JWT dependency.
  - `centrifugoConnect(request, resolveUser)` — the reply body for Centrifugo's
    connect proxy, from the same `resolveUser` a `WsAdapter` uses: a user
    connects, `null` disconnects with `4401`, a throwing resolver answers
    internal error `100`.
  - `CentrifugoAdapter({ url, apiKey, personalChannelNamespace? })` — registers
    the `CENTRIFUGO` client and a `WS_USER_BROADCASTER` that publishes to the
    user's personal channel (`#<user>`), so services written against
    `WsAdapter`'s broadcaster keep working unchanged.
  
  `@WsController` / `@OnMessage` do not apply: Centrifugo owns the sockets.

- [#692](https://github.com/forinda/kick-js/pull/692) [`4bc95ca`](https://github.com/forinda/kick-js/commit/4bc95cae20b473d291eac5c14be417a577a83ec5) Thanks [@forinda](https://github.com/forinda)! - Broadcasts can now reach sockets on every instance, not only the one that sent
  them. Pass a `broker` to `WsAdapter`; `@forinda/kickjs-ws/redis` ships one over
  Redis pub/sub.
  
  ```ts
  import Redis from 'ioredis'
  import { getEnv } from '@forinda/kickjs'
  import { WsAdapter } from '@forinda/kickjs-ws'
  import { redisBroker } from '@forinda/kickjs-ws/redis'
  
  const redis = new Redis(getEnv('REDIS_URL'))
  
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
  of the package — any client with `publish` / `subscribe` / `unsubscribe` /
  `on('message')` works, and `WsBroker` can be implemented over another pub/sub. Without a
  `broker` nothing changes.

## 7.0.2

### Patch Changes

- [#688](https://github.com/forinda/kick-js/pull/688) [`86edaad`](https://github.com/forinda/kick-js/commit/86edaadc37c1256fe04ec322ec1e3f896b054bcf) Thanks [@forinda](https://github.com/forinda)! - Fix WsAdapter breaking other upgrade handlers, dropping early messages, and
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

## 7.0.1

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

## 7.0.0

## 7.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78)]:
  - @forinda/kickjs@5.18.0-alpha.0

## 6.0.0

## 6.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0

## 5.2.3

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

## 5.2.2

### Patch Changes

- [#267](https://github.com/forinda/kick-js/pull/267) [`04cd61d`](https://github.com/forinda/kick-js/commit/04cd61d2d932ea3d2a642afc72e84bc80ee28907) Thanks [@forinda](https://github.com/forinda)! - deps: move `ws` from `dependencies` to `peerDependencies` in both packages

  Both `@forinda/kickjs-ws` and `@forinda/kickjs-devtools` shipped `ws@^8.20.1` as a hard `dependency`. Adopters who already had `ws` installed (very common — it's used directly, through `socket.io`, through `undici`, through tons of other libs) could end up with two copies in `node_modules`, which breaks `instanceof WebSocket` checks and confuses some bundlers.

  Both packages now declare `ws` as a `peerDependencies` entry at `^8.0.0`. `ws@^8.20.1` stays in `devDependencies` so the workspace install/build/test still resolves a copy. Modern package managers auto-install peers (pnpm 8+ with `auto-install-peers=true`, npm 7+), so most adopters need no action; pnpm strict-mode users add `ws` to their dependencies explicitly.

## 5.2.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.
