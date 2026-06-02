---
'@forinda/kickjs-vite': patch
'@forinda/kickjs-cli': patch
'@forinda/kickjs': patch
---

Fix two `kick dev` (Vite) lifecycle gaps — neither was Windows-specific, though Windows made the shutdown one worse.

- **App now bootstraps at startup, not on first request.** The dev-server plugin evaluated the app lazily via `ssrLoadModule` inside the request middleware, so `bootstrap()`, adapter `afterStart`, and your startup logs didn't run until the first HTTP request hit. The plugin now warms the module once the HTTP server is listening, so `kick dev` behaves like `node`/`tsx` — logs + adapters + the server come up immediately.
- **Graceful shutdown now runs on Ctrl+C in dev.** The app deliberately suppresses its own SIGINT/SIGTERM handlers in dev (Vite owns the lifecycle), and the CLI dev server only closed Vite — so `adapter.shutdown()`, request draining, and shutdown logs never ran. `Application.start()` now exposes its `shutdown()` on `globalThis` in dev, and `kick dev` awaits it before tearing down Vite. Also wires `SIGBREAK` (Windows Ctrl+Break) since Windows never raises `SIGTERM`.
