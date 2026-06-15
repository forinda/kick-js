---
'@forinda/kickjs': minor
'@forinda/kickjs-devtools': minor
---

DevTools now surfaces the active HTTP runtime and reports uptime correctly.

- **`Application.getActiveRuntime()`** (new) — returns `{ name, capabilities }` for the active engine (`express` / `fastify` / `h3`), so tooling can show which runtime an app runs on.
- **DevTools `/health`** includes `runtime`; **`/runtime`** includes a `process` block (`nodeVersion`, `pid`, `platform`, `arch`, `runtime`) — the Runtime tab now shows a strip making explicit that the memory / CPU / event-loop stats are for **this Node process** (the one running your app), with the engine, Node version, platform, and pid.
- **Uptime fix** — uptime was derived from a timestamp reset in `beforeMount`, which re-runs on every HMR rebuild / dev re-bootstrap and pinned it near `0s`. It now reads `process.uptime()`, which is monotonic from process start and survives reloads.
