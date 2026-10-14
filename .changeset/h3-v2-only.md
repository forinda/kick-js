---
'@forinda/kickjs': major
---

**Breaking:** the h3 runtime runs on h3 v2 only. h3 v1 support is removed.

- `h3Runtime()` from `@forinda/kickjs/h3` needs h3 v2, and fails at boot with the upgrade command when v1 is installed. Upgrade with `pnpm add h3@^2`; apps that only use KickJS APIs need no code change. Code that reaches into the engine (`getRuntimeApp()`, `ctx.req` as an `H3Event`) follows h3's migration guide.
- `h3Runtime({ h3 })` takes a pre-imported h3 module, for linked checkouts and bundlers.
- `H3RuntimeTypes` describes the h3 v2 runtime: `getRuntimeApp()` is the `H3` app.
- `h3WebRuntime()` (`@forinda/kickjs/h3-web`) is now a deprecated alias of `h3Runtime()`.

Also fixed on the h3 runtime and the `@forinda/kickjs/web` entry:

- Observers and the request logger see the matched route (`onResponse` `route`).
- A route uses the request id that `requestId()` middleware assigned, so the `X-Request-Id` header, `ctx.requestId` and `onError` / `onResponse` agree.
- `trustProxy` now sets `req.ip` from `X-Forwarded-For`, so rate limits bucket per client behind a proxy. `true`, a hop count and a function follow Express's rules. An address or subnet list is not supported on h3: it logs a warning and keeps the socket address.
- A connect middleware mounted at a list of paths or a regular expression now matches them. Before, the path was turned into a string and never matched.
