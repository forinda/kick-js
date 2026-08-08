---
'@forinda/kickjs': patch
---

Time-box each adapter and plugin `shutdown()` hook so one that never settles
cannot wedge an HMR reload, and log an error when a hook closes the shared dev
server.

`shutdown()` awaited an unbounded `Promise.allSettled` over every hook. A hook
with no path to settle hung the teardown forever. Since adapter teardown now
runs on every reload, that turned one misbehaving adapter into a dev server
that stopped rebuilding after the first save — with no error explaining why.

The trigger in the wild was a socket.io adapter calling `io.close(cb)`. Two
distinct traps, both fatal here:

- `io.close()` closes the HTTP server socket.io was constructed with. In dev
  that is the Vite server, and nothing rebinds it — every later request is
  ECONNREFUSED and the process stays alive, so it reads as a hang rather than
  a crash.
- Its callback fires only once every client disconnects, so a single open
  browser tab meant the promise never resolved.

Each hook now gets its own budget: `shutdownTimeout` on a real shutdown, or
`min(shutdownTimeout, 5s)` on a reload — nobody should wait 30s per save. A
hook that overruns is logged by name and skipped, and the remaining hooks
still run, so one wedged adapter no longer costs its neighbours their
teardown.

A reload that ends with the shared server no longer listening now logs an
explicit error naming the cause, instead of failing silently.
