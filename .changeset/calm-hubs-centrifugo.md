---
'@forinda/kickjs-ws': minor
---

Add `@forinda/kickjs-ws/centrifugo` for apps that hand client connections to
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
