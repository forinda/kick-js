---
'@forinda/kickjs-devtools': minor
'@forinda/kickjs-devtools-kit': minor
---

DevTools dashboard: fewer tabs, a readable dependency graph, and two fixes.

- **Topology moved into Runtime.** Plugins, adapters and contributors now sit under the process charts as **Plugged in**. Each card lists the lifecycle hooks the plugin or adapter implements (`beforeStart`, `middleware`, `shutdown`, …), so one without `introspect()` no longer reads "Reports nothing". `IntrospectionSnapshot` gains an optional `hooks` field (typed by the new `LifecycleHook` union), filled in by DevTools; each hook shows as a chip that explains itself on hover.
- **Graph moved into Container.** A **Details / Graph** switch sits beside the token list. With a token selected the graph narrows to its chain (what it depends on and what depends on it) and frames it, instead of a 20%-zoom hairball on a big app; **Whole graph** shows everything. The legend has a colour for `other`.
- **Container list:** sort by resolves, last resolve or name; a **never resolved** filter; empty filter chips are hidden; rows show `factory` / `instance` for tokens registered that way, not `other`; the full token name shows on hover.
- **Overview:** an adapter reporting `up` from its health check is green, not amber; `down` / `stopped` are red.
- **Requests:** long id segments in paths are cut short (`/items/01J9ZK…/comments`), the full path on hover.
- **Sidebar:** Database, Queues and Activity are dimmed until something reports to them.
- Remembered `topology` and `graph` tabs open Runtime and Container.
- **Fix:** uptime keeps counting. It was a `computed()` over the process clock, which is not reactive, so it cached its first read; Overview, the DevToolsAdapter card and `/_debug/health` showed the same few seconds forever.
- **Fix:** the dashboard ships its own favicon, so opening `/_debug` no longer requests `/favicon.ico` from the app — that 404 showed up in Requests and Recent failures.
