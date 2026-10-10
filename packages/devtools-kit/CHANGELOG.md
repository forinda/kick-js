# @forinda/kickjs-devtools-kit

## 7.2.0

### Minor Changes

- [#831](https://github.com/forinda/kick-js/pull/831) [`f1cd595`](https://github.com/forinda/kick-js/commit/f1cd59580feecfa6f9493ef8bd3c5c1337dec349) Thanks [@forinda](https://github.com/forinda)! - DevTools dashboard: fewer tabs, a readable dependency graph, and two fixes.
  
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

## 7.1.0

### Minor Changes

- [#771](https://github.com/forinda/kick-js/pull/771) [`3d9c64b`](https://github.com/forinda/kick-js/commit/3d9c64b23c78a7a8903ce0158cc8b9ddc62de28c) Thanks [@forinda](https://github.com/forinda)! - Custom tabs can run server code and render live content.
  
  - **`launch` buttons work:** an action's new `run()` executes on the server when its button is clicked, and the dashboard shows what it returns (or the error). Before, every button posted to a route nothing served and got a 404.
  - **`module` view:** `view: { type: 'module', src }` loads a browser module from the app's own origin and mounts its default export — a `defineDevtoolsRenderTab(...)` spec or a `render(el, props)` function — with the dashboard's event bus. `defineDevtoolsRenderTab` was exported before but nothing rendered it. Modules from other origins are refused.

- [#771](https://github.com/forinda/kick-js/pull/771) [`7b7d778`](https://github.com/forinda/kick-js/commit/7b7d778d32fb6f9bb8fdfd168aa76bb92a391d01) Thanks [@forinda](https://github.com/forinda)! - Manage jobs from DevTools.
  
  - **`JobInspector`** (devtools-kit): the contract the DevTools Queues tab uses to list queues, page through jobs by state, read one job, and — when implemented — retry, remove, retry all failed, clean a state, and pause / resume. Any job tool can implement it; an adapter or plugin exposes it as `jobInspector()`.
  - **`QueueAdapter`** implements it for BullMQ. Providers with no job store (RabbitMQ, Kafka, Redis pub/sub) list their queues without jobs.
  - **The queue package's own DevTools panel is gone:** the built-in Queues tab replaces the iframe tab and its `/_kick/queue/panel` and `/_kick/queue/data` routes (the data route carried no auth). The `panel` option is deprecated and has no effect.

### Patch Changes

- [#771](https://github.com/forinda/kick-js/pull/771) [`f64c9bf`](https://github.com/forinda/kick-js/commit/f64c9bf1b67ab57c7e288be7a82be9c59fce24e2) Thanks [@forinda](https://github.com/forinda)! - DevTools fixes.
  
  - **No false leak alarm at boot:** memory health ignores the first 30 seconds of uptime and waits for 20 seconds of settled samples before judging heap growth. Until then it reports `sampling: true` with severity `ok`. Before, normal startup allocation read as "critical" within seconds.
  - **Consistent DI counts:** `/_debug/container` leaves out the dev server's `__hmr__` shadow registrations, like the topology and graph endpoints already did.
  - **Readable labels in light theme:** kind and status labels no longer use dark-only colours.
  - **No stray horizontal scrollbar:** hidden metric tooltips near the right edge no longer widen the page.

## 7.0.2

### Patch Changes

- [#604](https://github.com/forinda/kick-js/pull/604) [`bfb9319`](https://github.com/forinda/kick-js/commit/bfb9319d0b9d66c80d874352e93f7c9afcbef4ab) Thanks [@forinda](https://github.com/forinda)! - README corrections and cuts — a version bump so they reach npm.
  
  The README is what npmjs.com renders, and it ships in the tarball, so a fix
  only reaches readers on a publish. These four packages have no code change in
  this release; the bump exists to publish the README.
  
  - **mcp** — `@Roles('admin')` and `@Public()` came from `@forinda/kickjs-auth`,
    which no longer exists. Five passages described the adapter as running an
    "Express pipeline"; it dispatches through the shared HTTP pipeline on any
    runtime. Cut 560 → 176 lines: the auth-pattern walkthrough, three ASCII
    diagrams, the troubleshooting table and an alternative the README itself
    called not-recommended are all in the guide.
  - **schema** — cut 283 → 132. Per-adapter internals, two resolution orders and
    a full Joi adapter implementation live in the guide; the `KickSchema`
    interface and the subpath table, which are the decisions, stay.
  - **grpc** — cut 206 → 121. Kept the protocol-support table.
  - **devtools-kit** — the recommended dependency shape said `>=5.0.0` / `^5.0.0`
    for a package published at 7.0.1.
  
  `@forinda/kickjs`, `-cli` and `-testing` also had README changes and are
  already bumping in this release, so they need no entry here.

## 7.0.1

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

## 7.0.0

## 7.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78)]:
  - @forinda/kickjs@5.18.0-alpha.0

## 6.0.0

## 6.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0

## 5.4.1

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

## 5.4.0

### Minor Changes

- [#252](https://github.com/forinda/kick-js/pull/252) [`9f1e90e`](https://github.com/forinda/kick-js/commit/9f1e90e00160dfb3801e8bac451ace0aa7b3f37f) Thanks [@forinda](https://github.com/forinda)! - feat(devtools): render full introspect snapshot + surface module-level contributors with intact dependsOn

  Three related fixes addressing two adopter reports: the DevTools dashboard wasn't surfacing data that `introspect()` and context-contributor `dependsOn` were already providing.

  **1. PrimitiveRow renders all `IntrospectionSnapshot` fields**

  The server side has been collecting `introspect()` snapshots correctly for every adapter / plugin in `/_debug/topology`. The SPA's `PrimitiveRow` in `TopologyTab.tsx` only rendered `name`, `version`, `tokens.provides`, and `metrics` — silently dropping `state`, `tokens.requires`, `memoryBytes`, and `kind`. Adopters whose `introspect()` returned (say) `{ state, memoryBytes, tokens: { requires } }` saw a row with just the name.

  PrimitiveRow now renders all six fields, with `memoryBytes` formatted as B/KB/MB/GB and `state` rendered as key/value pairs (JSON-stringified for nested objects).

  **2. Module-level contributors surface via `Application.getContributors()`**

  The framework's `getContributors()` deliberately skipped module-level registrations because module instances aren't retained on the `Application` instance post-bootstrap. Adopters who declared `AppModule.contributors?()` returning a typed `dependsOn` saw the contributor missing entirely from the DevTools Contributors table, which read as "empty deps."

  `Application.setup()` now retains a snapshot of every module-level registration (just the frozen `{ key, dependsOn }` view — no `resolve` closures kept), and `getContributors()` returns those entries with `source: 'module'`. The snapshot is cleared at the start of each `setup()` pass so test harnesses and dev-server restarts don't accumulate stale entries.

  Per-route (method/class decorator) contributors still aren't enumerated — they live on the route registry and warrant a separate RPC; flagged as a follow-up.

  **3. `TopologyContributorEntry.source` widens to the full union**

  The kit's `source` field was typed as bare `string` with a JSDoc-documented enum; the server collapsed `'plugin' | 'global'` → `'adapter'` because of an earlier narrower mapping. Both are now removed: kit ships a proper `TopologyContributorSource` union (`'method' | 'class' | 'module' | 'adapter' | 'plugin' | 'global'`), and the server passes `source` through unchanged. Dashboards can now badge / filter by the real origin. Wire-format change is backward-compatible (new enum value added to an existing string field).

  **4. `IntrospectionSnapshot` reachable from `@forinda/kickjs` directly**

  `AppAdapter.introspect?()` and `KickPlugin.introspect?()` were typed as `unknown` — the JSDoc told adopters to import `IntrospectionSnapshot` from `@forinda/kickjs-devtools-kit` to satisfy the contract, taking on a dep just for the type. The snapshot type now lives canonically in `@forinda/kickjs` (`core/introspect.ts`); the kit's existing `IntrospectionSnapshot` stays structurally identical for back-compat. Adopters who don't already use the kit can write `introspect()` with full inference, no extra import:

  ```ts
  export const MyAdapter = defineAdapter({
    name: 'MyAdapter',
    build: () => ({
      introspect() {
        // Return-type fully inferred — no `import type` needed.
        return {
          protocolVersion: 1,
          name: 'MyAdapter',
          kind: 'adapter',
          state: { connectedAt: Date.now() },
          memoryBytes: 12_345,
          tokens: { provides: ['REDIS'], requires: [] },
          version: '1.0',
          metrics: { activeConnections: 3 },
        }
      },
    }),
  })
  ```

  **Tests**

  `application-get-contributors.test.ts` adds three cases: `dependsOn` survives `getContributors()` (regression guard); module-level contributors appear after `setup()` with `source: 'module'` and intact `dependsOn`; re-setup doesn't accumulate stale module entries.

## 5.3.2

### Patch Changes

- [#240](https://github.com/forinda/kick-js/pull/240) [`4eebd43`](https://github.com/forinda/kick-js/commit/4eebd43f259c1d5b7214acd46efc6c6d277ee82f) Thanks [@forinda](https://github.com/forinda)! - fix(devtools): two audit-found correctness wins

  **`routeLatency` map no longer grows unboundedly under 404 probing**
  (`@forinda/kickjs-devtools`).

  The request-tracking middleware keyed `routeLatency` by
  `${req.method} ${req.route?.path ?? req.path}` — when no route matched,
  the fallback used the raw URL, so every probed 404 path became its own
  entry. The samples ring buffer was capped at 1000, but the map itself
  had no cap; an attacker hammering random paths could inflate
  `/_debug/metrics` payloads and leak memory indefinitely. Unmatched
  requests now collapse into a single `<unmatched>` bucket per HTTP
  method.

  **`DEVTOOLS_BUS` token doc drift** (`@forinda/kickjs-devtools-kit`).

  The JSDoc claimed the adapter registered the bus in `beforeStart`, but
  it actually registers in `beforeMount`. Doc-only fix — no runtime
  change.

## 5.3.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

## 5.3.0

### Minor Changes

- [#161](https://github.com/forinda/kick-js/pull/161) [`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98) Thanks [@forinda](https://github.com/forinda)! - Add `@forinda/kickjs-devtools-kit/bus/token` subpath that exports `DEVTOOLS_BUS` separately from the bus runtime. Browser SPAs and other framework-free consumers can now import from `/bus` without pulling `createToken` (and through it the entire `@forinda/kickjs` runtime) into their bundle. Server-side adapters and plugins that need the DI token import it from `/bus/token`.

  The README now documents every subpath (`.`, `/runtime`, `/types`, `/bus`, `/bus/token`) with whether each one pulls in the framework, and the lockstep-versioning claim has been replaced with the Changesets-based flow.
