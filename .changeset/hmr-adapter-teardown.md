---
'@forinda/kickjs': patch
---

Dispose the previous app on HMR rebuild instead of leaking it

`bootstrap()` keeps the live app on `globalThis.__app`, and the reload path
already tested for it — then replaced it without tearing it down:

```ts
if (g.__app) {
  const freshApp = new Application(options)
  g.__app = freshApp // old one dropped, still running
}
```

`shutdown()` ran only from the `SIGINT` / `SIGTERM` handler, so in a dev session
every save added another live adapter set on top of the last.

Seen in production dev environments as a single API process holding several
Kafka consumer-group members. On a single-partition topic only one member can
hold the assignment, and it was a leaked consumer from an earlier reload wired
to nothing — so queued jobs silently stopped being processed, and the group had
never committed an offset. The same leak put two socket.io servers on one HTTP
server, crashing `handleUpgrade()`.

`Application.shutdown()` gains `{ closeServer?: boolean }`, and the reload path
passes `false`. That distinction is load-bearing: in dev the HTTP server is
shared across rebuilds via `globalThis.__kickjs_httpServer`, so a full shutdown
would close the listening socket and kill HMR on the first save. Adapters,
plugins, and disposables are torn down; the socket stays up. In-flight draining
is skipped too — the server keeps serving, so there is nothing to drain toward.

Teardown failures are logged rather than thrown, so one broken adapter cannot
leave the dev server with no app at all.
