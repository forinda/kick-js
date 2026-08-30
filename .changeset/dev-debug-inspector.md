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

A port it cannot take (`Inspector is already activated`) is now reported with a
pointer to `--inspect-port`, instead of being swallowed.
