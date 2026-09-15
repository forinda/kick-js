---
'@forinda/kickjs': minor
---

`createHandler(options)` serves a KickJS app as request handlers instead of a
listening server — the entry for Netlify Functions, Vercel Functions and other
hosts that hand you requests rather than a port.

```ts
import { createHandler } from '@forinda/kickjs'
import { modules } from './modules'

export const handler = createHandler({ modules })

// Netlify: export default (request) => handler.fetch(request)
// Vercel (Node): export default handler.node
```

It takes the same options as `bootstrap()`. The app is set up once per process,
lazily on the first request (or eagerly via `handler.ready()`), with the same
`setup()` and plugin `onReady` as `bootstrap()` — but no port, no `afterStart`
(a warning names adapters that rely on it) and no process signal or error
handlers. A failed setup is retried on the next request. `handler.close()` shuts
adapters down.

`handler.fetch(request)` uses the runtime app's own `fetch` when it has one (the
h3 v2 runtime). For Node-based runtimes such as the default Express, the request
is forwarded to an in-process server bound to `127.0.0.1` on a random port,
started on first use: request bodies are buffered, hop-by-hop headers dropped,
`x-forwarded-host` / `x-forwarded-proto` set, and the response streamed back with
every `Set-Cookie` intact. A direct Request→`res` bridge was tried and rejected —
Express 5 replaces the response prototype, which breaks it.

New `Application.startWithoutServer()` is the lifecycle `createHandler` runs.
