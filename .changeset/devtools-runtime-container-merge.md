---
'@forinda/kickjs-devtools': minor
'@forinda/kickjs-devtools-kit': minor
'@forinda/kickjs-ws': minor
---

DevTools dashboard: fewer tabs, a readable dependency graph, and two fixes.

- **Topology moved into Runtime.** Plugins, adapters and contributors now sit under the process charts as **Plugged in**. Each card lists the lifecycle hooks the plugin or adapter implements (`beforeStart`, `middleware`, `shutdown`, …), so one without `introspect()` no longer reads "Reports nothing". `IntrospectionSnapshot` gains an optional `hooks` field (typed by the new `LifecycleHook` union), filled in by DevTools; each hook shows as a chip that explains itself on hover.
- **Graph moved into Container.** A **Details / Graph** switch sits beside the token list. With a token selected the graph narrows to its chain (what it depends on and what depends on it) and frames it, instead of a 20%-zoom hairball on a big app; **Whole graph** shows everything. The legend has a colour for `other`.
- **Container list:** sort by resolves, last resolve or name; a **never resolved** filter; empty filter chips are hidden; rows show `factory` / `instance` for tokens registered that way, not `other`; the full token name shows on hover.
- **Overview:** an adapter reporting `up` from its health check is green, not amber; `down` / `stopped` are red.
- **Requests:** long id segments in paths are cut short (`/items/01J9ZK…/comments`), the full path on hover.
- **Sidebar:** Sockets, Database, Jobs and Activity are dimmed until something reports to them.
- Remembered `topology` and `graph` tabs open Runtime and Container.
- **Fix:** uptime keeps counting. It was a `computed()` over the process clock, which is not reactive, so it cached its first read; Overview, the DevToolsAdapter card and `/_debug/health` showed the same few seconds forever.
- **Fix:** the dashboard ships its own favicon, so opening `/_debug` no longer requests `/favicon.ico` from the app — that 404 showed up in Requests and Recent failures.
- **Fix:** the live stream re-sends the counters every 5 seconds, so on an idle app the Overview's uptime and the header's "Updated" time keep moving instead of freezing at the last request.
- **Fix:** the Runtime CPU chart no longer spikes into the thousands of percent after the tab opens. The stream re-sent the sample the history ended with, and a duplicate divided its CPU time by a ~0ms gap; samples now merge by timestamp.
- **API runner:** **Save to variable** is its own section in a route's runner, so you can set it up before the first send — it used to appear only under a response. **Save now** copies from the response on screen. The Environments sheet says changes save as you type and where they're kept, and how a route's Save to variable fills its variables.
- **API runner:** a route's **Settings** says they apply to every route and save in this browser, and each field — CSRF cookie and header, OpenAPI URL, editor link, Fill empty inputs from OpenAPI — explains what it does.
- **API runner:** disabled buttons (Save now before a response, Active, Delete on the last environment) look disabled.
- **API runner, Form data:** each row shows its type, name, value or file picker, and a ✕ to remove it — the Text / File dropdown used to stretch across the row and push the rest out of view. A file field with nothing picked shows in the code snippet as `-F 'file=@<file>'` instead of vanishing.
- **Fix:** event-loop delay no longer reads ~20 ms on an idle app. `monitorEventLoopDelay` times its own 20 ms timer, so every value carried that period; `RuntimeSampler` now subtracts it, and an idle loop reads ~0.
- **Runtime, Plugged in:** plugin and adapter cards show their `dependsOn` as **after** chips, like contributors do; hovering one lights up that plugin's card. `IntrospectionSnapshot` gains an optional `dependsOn`, filled in by DevTools.
- **Fonts:** the header's settings take an interface font and a code / editor font. They go ahead of the dashboard's own fonts, which stay as the fallback; remembered per browser.
- **Jobs tab** (was Queues): a **Scheduled** view lists every `@Cron` job whatever runs it — schedule, next run (with `croner` installed), last run with outcome, duration and error, runs and failures — with **Run now**. DevTools counts runs by wrapping each job's method once. New endpoints `GET /_debug/cron` and `POST /_debug/cron/run?name=`. The queue browser is the **Queues** view.
- **Sockets tab:** `WsAdapter`'s namespaces with open connections and events, and a client — connect (query and subprotocols with `{{variables}}` from the active environment — e.g. `bearer, {{token}}`), send `{ event, data }`, watch frames in and out.
- **ws:** `getStats().namespaces[path].events` lists the `@OnMessage` events each namespace answers.
- **Sidebar:** each tab's accessible name is its label; in the icon rail a tab with a count used to be announced as just the number.
