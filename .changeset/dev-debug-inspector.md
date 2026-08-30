---
'@forinda/kickjs-cli': patch
---

`kick dev:debug`: actually attach the debugger

The command printed `Debugger: ws://0.0.0.0:9229` and attached nothing. It set
`process.env.NODE_OPTIONS = '--inspect=…'` and then started the dev server in
the same process — but Node reads `NODE_OPTIONS` once, at startup, and
`startDevServer` calls Vite's `createServer` directly rather than spawning. The
server came up normally and port 9229 stayed closed, so nothing ever failed.

It now uses `inspector.open()`, which opens the port on the running process,
and prints `inspector.url()` rather than a hand-built one — the real URL
carries the session id, without which a debugger client cannot attach even to
an open port.

It also binds to **loopback** now, as `node --inspect` does. The old code
hardcoded `0.0.0.0`, which never mattered while nothing was listening — but an
attached inspector can evaluate arbitrary code in the process, so making it
work turned that into a real open port on every interface. `--inspect-host` is
there for containers, which legitimately need `0.0.0.0`, and warns when the
address is not loopback.

A port it cannot take (`Inspector is already activated`) is now reported with a
pointer to `--inspect-port`, instead of being swallowed.
