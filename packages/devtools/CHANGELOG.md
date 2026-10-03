# @forinda/kickjs-devtools

## 7.4.0

### Minor Changes

- [#771](https://github.com/forinda/kick-js/pull/771) [`72f2772`](https://github.com/forinda/kick-js/commit/72f2772741e8c33299503b74d59a925327b432a9) Thanks [@forinda](https://github.com/forinda)! - A denser dashboard layout.
  
  - **Icon sidebar:** the sidebar is a column of icons with tooltips and count badges. It can be expanded to labels, and the choice is remembered.
  - **Routes:** a list grouped by controller, searchable and filterable by method, with the API runner open beside it. The divider can be resized, and its width is remembered. This replaces the paginated table and the overlay sheet.
  - **Runner:** the method, resolved URL and **Send** sit in one bar at the top. Response and history statuses are colored pills.
  - **Disconnect banner:** when the app stops answering, a banner says so and the dashboard keeps retrying. Before, it quietly stayed on "Polling" with stale data.
  - **Command palette:** ⌘K / Ctrl+K (or `/`) finds a tab, route or DI token and jumps to it, and switches theme or density.
  - **Requests tab:** the app's recent requests (status, method, path, duration, and the error a failed one threw), filterable by status, with a detail pane and **Replay in runner**. Served from the new `GET /_debug/requests`; `requestLog` sets how many are kept (default 200).
  - **Overview:** a strip of headline numbers (requests, server errors, p95 latency, heap) with last-minute sparklines, the latest failed requests with their errors, and app status with adapter status dots. Replaces the three cards.
  - **Runtime:** the Memory tab is folded into Runtime — four charts (heap, process memory, event-loop delay with GC ticks, CPU) over the last minute, memory health, and the heap-snapshot / force-GC actions in the header.
  - **Metrics:** a sortable per-route table with 5xx share, percentile bars and a latency histogram per route. `/_debug/metrics` adds `serverErrors`, `clientErrors` and `histogram` to each route, and `latencyBucketsMs`.
  - **Container:** a list with kind and scope filters (with counts) and the selected token's dependencies, dependents and resolve stats beside it, replacing the paginated table and the detail modal. First and last resolve times now show — the dashboard read the wrong field names before.
  - **Graph:** a real dependency graph on a canvas — tokens in columns with arrows, drag to rearrange (remembered), pan and zoom, focus on a token's whole chain, cycle edges in red, and token details beside it. Before, it was a list grouped by kind.
  - **Topology:** plugins, adapters and contributors as side-by-side cards with their counters, state and provided / required tokens (hover to highlight, click to open in Container). The duplicate DI table is gone — Container has it.
  - **Activity:** namespace chips with counts, tinted error and warning rows, a held list with **N new** while you read, and the selected event's full payload beside the stream. Replaces the paginated table.
  - **Database:** a **Slowest** view grouping statements by shape (calls, failures, mean, p95, total) next to the **Recent** log, with the full SQL, parameters and error beside them.
  - **Scrollbars:** thin and theme-coloured everywhere.
  - **Queues:** browse jobs by queue and state, see a job's data, result, failure and stack traces, and retry, remove, retry all failed, clean a state, or pause / resume a queue. Served from new `/_debug/jobs*` endpoints over any `jobInspector()` an adapter or plugin exposes.

- [#771](https://github.com/forinda/kick-js/pull/771) [`3d9c64b`](https://github.com/forinda/kick-js/commit/3d9c64b23c78a7a8903ce0158cc8b9ddc62de28c) Thanks [@forinda](https://github.com/forinda)! - Custom tabs can run server code and render live content.
  
  - **`launch` buttons work:** an action's new `run()` executes on the server when its button is clicked, and the dashboard shows what it returns (or the error). Before, every button posted to a route nothing served and got a 404.
  - **`module` view:** `view: { type: 'module', src }` loads a browser module from the app's own origin and mounts its default export — a `defineDevtoolsRenderTab(...)` spec or a `render(el, props)` function — with the dashboard's event bus. `defineDevtoolsRenderTab` was exported before but nothing rendered it. Modules from other origins are refused.

### Patch Changes

- [#771](https://github.com/forinda/kick-js/pull/771) [`f64c9bf`](https://github.com/forinda/kick-js/commit/f64c9bf1b67ab57c7e288be7a82be9c59fce24e2) Thanks [@forinda](https://github.com/forinda)! - DevTools fixes.
  
  - **No false leak alarm at boot:** memory health ignores the first 30 seconds of uptime and waits for 20 seconds of settled samples before judging heap growth. Until then it reports `sampling: true` with severity `ok`. Before, normal startup allocation read as "critical" within seconds.
  - **Consistent DI counts:** `/_debug/container` leaves out the dev server's `__hmr__` shadow registrations, like the topology and graph endpoints already did.
  - **Readable labels in light theme:** kind and status labels no longer use dark-only colours.
  - **No stray horizontal scrollbar:** hidden metric tooltips near the right edge no longer widen the page.

- [#771](https://github.com/forinda/kick-js/pull/771) [`f4ec61e`](https://github.com/forinda/kick-js/commit/f4ec61e6a230888cde15fd59b5a61ea92e30dd3c) Thanks [@forinda](https://github.com/forinda)! - Custom DevTools tabs.
  
  - **`kick g adapter` / `kick g plugin`:** both now write the `introspect()` and `devtoolsTabs()` hooks (commented out), in shapes that type-check once uncommented. Before, the adapter's tab example used fields the descriptor doesn't have (`kind`, `render`), its snapshot was missing `name` and `kind`, and neither example said where `defineDevtoolsTab` or `IntrospectionSnapshot` come from. The comments now name the import and the `@forinda/kickjs-devtools-kit` dependency to add.
  - **Iframe tabs:** the dashboard token is only added to an iframe `src` on the app's own origin. It was appended to every `src`, so a tab pointing at another site received the token.
- Updated dependencies [[`f64c9bf`](https://github.com/forinda/kick-js/commit/f64c9bf1b67ab57c7e288be7a82be9c59fce24e2), [`3d9c64b`](https://github.com/forinda/kick-js/commit/3d9c64b23c78a7a8903ce0158cc8b9ddc62de28c), [`7b7d778`](https://github.com/forinda/kick-js/commit/7b7d778d32fb6f9bb8fdfd168aa76bb92a391d01)]:
  - @forinda/kickjs-devtools-kit@7.1.0

## 7.3.0

### Minor Changes

- [#756](https://github.com/forinda/kick-js/pull/756) [`3a36506`](https://github.com/forinda/kick-js/commit/3a36506e40fa13fddd3387b9cd7d6031f5b9a03e) Thanks [@forinda](https://github.com/forinda)! - The DevTools dashboard has an API runner. **Try** on a row of the Routes tab opens a side sheet that sends a request to that route from the browser, on the same origin, so it works on every runtime with no extra endpoint.
  
  **Sections** (each collapsible):
  
  - **Path params:** one field per `:param`.
  - **Query and headers:** key/value rows that can be switched off.
  - **Body:** raw text, or **form data** (`multipart/form-data`) with text fields and file pickers, for testing uploads. A route with `@FileUpload` opens in form mode with its field ready. `/_debug/routes` now reports each route's `@FileUpload` settings as `upload`.
  - **Environment:** default headers, variables and settings. They're kept for the browser tab unless **Remember on this browser** is on, which moves them to `localStorage`.
  - **Code snippet:** the request rendered as `curl` or `fetch`, readable and selectable.
  - **Response:** status, time, headers, and the body pretty-printed as JSON, with **Save to variable** to capture a value from it.
  
  **Variables:** `{{name}}` works in any param, query, header or body value, and a variable with no value is flagged. **Save to variable** reads a JSON path (`data.token`, `items[0].id`) from a response. So you can log in once, save the token, and a default `Authorization: Bearer {{token}}` header is sent on every route.
  
  **Built-in handling:**
  
  - It reads the CSRF cookie and sends the matching header on unsafe methods.
  - It leaves out a default `Authorization` header on routes carrying a public route flag. The flag name is configurable, and several can be listed.
  - `DELETE`, `PUT` and `PATCH` need a second click before they're sent.
  - The devtools token is never sent to app routes.

- [#747](https://github.com/forinda/kick-js/pull/747) [`901efeb`](https://github.com/forinda/kick-js/commit/901efeb9a01b34f49ce8331a02629399754edcbc) Thanks [@forinda](https://github.com/forinda)! - DevTools now runs on every HTTP runtime: Express, Fastify, and h3.
  
  Every `/_debug/*` endpoint used to answer through Express's `req` / `res`, and the dashboard files were served with `express.static`, so the adapter only worked on the Express runtime. Now:
  
  - Routes answer through `RequestContext`: `ctx.json`, `ctx.html`, and `ctx.sse()` for the three live streams.
  - The heap snapshot streams through `ctx.sendResponse`, with backpressure. It is never buffered whole in memory.
  - The dashboard files are served with `http.serveStatic`.
  - The token guard runs inside each route, so it no longer depends on how an engine parses the request path and query.
  - Per-route latency is keyed by the matched route pattern on every engine. It reads the slot each runtime publishes for `ctx.route`, instead of Express's `req.route`.
  
  **Peer dependencies:** `express` is no longer a peer. `@forinda/kickjs` now requires `>=8.6.0` (was `>=8.2.0`), the first release with `ctx.sendResponse`.
  
  **Also fixed on Express:** `GET /_debug` used to be answered by the static middleware with a 301 redirect. That meant the page with `data-base` injected was never served, which broke custom `basePath` mounts. The dashboard route now owns the page on every engine, and only `assets/` is served statically.

- [#759](https://github.com/forinda/kick-js/pull/759) [`2a949b8`](https://github.com/forinda/kick-js/commit/2a949b8ac7d72b644a74845dc981abdfbac1a93f) Thanks [@forinda](https://github.com/forinda)! - The API runner gains history, OpenAPI prefill, and open handler in editor.
  
  - **History:** the last 30 requests across all routes, with status and time. Click one to reopen its route with the inputs it was sent with. Kept in `localStorage`, with `{{variables}}` as written rather than their values.
  - **OpenAPI prefill:** when the app serves a spec (`/openapi.json` by default, configurable), a route opened for the first time gets its query parameters and an example JSON body from the request schema. Summaries and parameter descriptions show as hints, and **Fill empty inputs from OpenAPI** applies it later without overwriting what you typed.
  - **Open in editor:** click the handler name in the runner to open it in your editor, through a configurable link (`vscode://file{file}:{line}` by default).
  - **`GET /_debug/source?controller=&handler=`:** new endpoint that finds a registered route's handler under the project's `src/`. The VS Code extension uses it too.

### Patch Changes

- [#745](https://github.com/forinda/kick-js/pull/745) [`8701026`](https://github.com/forinda/kick-js/commit/87010264db5118c8a9d6d3eb3b40b0db4dd93b94) Thanks [@forinda](https://github.com/forinda)! - Raise the `@forinda/kickjs` peer range from `>=5.18.0` to `>=8.2.0`.
  
  The adapter imports `getRouteFlags`, which `@forinda/kickjs` first exported in 8.2.0. On 5.18–8.1 the peer range was satisfied but the app failed at startup on the missing export. The range now says what the package actually needs, so the package manager warns at install time instead.

- [#757](https://github.com/forinda/kick-js/pull/757) [`3ac7432`](https://github.com/forinda/kick-js/commit/3ac74329d235b585504ec020afaf7186c9449c59) Thanks [@forinda](https://github.com/forinda)! - The dashboard's request counters and per-route latency are fed from the framework's `onResponse` hook instead of their own middleware, on `@forinda/kickjs` releases that have it. Older releases keep the middleware.
  
  Latency is now keyed by the full route pattern (`GET /api/v1/users/:id`). Before, two modules' routes with the same relative path (`/users/:id` and `/orders/:id`) shared one bucket.

- [#753](https://github.com/forinda/kick-js/pull/753) [`91fc6a2`](https://github.com/forinda/kick-js/commit/91fc6a20b493281f2d7c46133b66fe7c2c719ae0) Thanks [@forinda](https://github.com/forinda)! - The dashboard now stores its access token in a cookie scoped to the devtools base path (for example `/_debug`) instead of `path=/`. At `path=/` the browser sent the devtools secret with every request to the app, so any request logger or handler could see it. The root-path cookie written by earlier versions is removed the next time the dashboard loads.

- [#752](https://github.com/forinda/kick-js/pull/752) [`f1d1114`](https://github.com/forinda/kick-js/commit/f1d11147f64c5d053d00b4159216b8ca635058cb) Thanks [@forinda](https://github.com/forinda)! - `bootstrap({ server: { tls, http2 } })`: serve HTTPS, and optionally HTTP/2, from the production server.
  
  - `{ tls }` serves HTTPS on every runtime (`https.createServer`).
  - `{ tls, http2: true }` serves HTTP/2 with HTTP/1.1 fallback (`http2.createSecureServer` with `allowHTTP1: true`) on Fastify and h3. HTTP/1.1 clients and WebSocket handshakes keep working on the same port.
  - `http2: true` on the Express runtime fails at boot with **KICK007**, because Express does not run on Node's HTTP/2 compatibility layer. `http2` without `tls` fails with **KICK008**. Both checks run before `setup()`.
  - `RuntimeCapabilities` gains an optional `http2` flag. Custom runtimes opt in; if it's absent, the runtime is treated as not supporting HTTP/2.
  - The option is ignored in dev mode, where Vite owns the server, with a warning.
  
  **Type change:** `AdapterContext.server` and `Application.getHttpServer()` are now typed `KickServer` (`http.Server | https.Server | http2.Http2SecureServer`, exported) instead of `http.Server`. Adapters that only attach to `upgrade` or read `address()` need no change. Code that relies on `http.Server`-only members must narrow the type first.
  
  `@forinda/kickjs-devtools`: the WebSocket bus accepts any `KickServer`.
- Updated dependencies []:
  - @forinda/kickjs-devtools-kit@7.0.2

## 7.2.0

### Minor Changes

- [#635](https://github.com/forinda/kick-js/pull/635) [`6983c06`](https://github.com/forinda/kick-js/commit/6983c0693b31e9fdc073868773c6271defa79ece) Thanks [@forinda](https://github.com/forinda)! - Route flags reach the OpenAPI spec and the DevTools dashboard (phase 4 of `route-flags-design.md`).
  
  **`getRouteFlags(controllerClass, handlerName)`** resolves a route's flags from the controller — the same method-over-class result `ctx.route.flags` carries at request time, for consumers that see a controller and a method name rather than a live request: an adapter's `onRouteMount`, spec generation, tooling.
  
  **Swagger gains `publicFlag`.** Name the flag your project uses for public endpoints and the spec reads the same declaration the runtime does, instead of asking for a second annotation that can drift from it:
  
  ```ts
  export const Public = defineRouteFlag('auth.public')
  
  SwaggerAdapter({ bearerAuth: true, publicFlag: 'auth.public' })
  ```
  
  The name is configuration rather than a constant, because the framework deliberately names no flags — one project's `auth.public` is another's `public` or `security.none`. A list accepts several. It sits after `@ApiPublic` and `securityResolver` in the resolution order and before the `@ApiSecurity` / `@ApiBearerAuth` decorators, so an explicit resolver still wins while a flag still overrides class-level security.
  
  **DevTools reports flags per route.** `GET /_debug/routes` includes a `flags` object on each entry, and the dashboard's Routes tab shows them in a Flags column — so "why does this endpoint not require auth" is answerable from the route list rather than by reading the controller. Only flags in force appear: one turned off at the method is absent, not `false`.

### Patch Changes

- Updated dependencies []:
  - @forinda/kickjs-devtools-kit@7.0.2

## 7.1.2

### Patch Changes

- Updated dependencies [[`bfb9319`](https://github.com/forinda/kick-js/commit/bfb9319d0b9d66c80d874352e93f7c9afcbef4ab)]:
  - @forinda/kickjs-devtools-kit@7.0.2

## 7.1.1

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

- Updated dependencies [[`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783)]:
  - @forinda/kickjs-devtools-kit@7.0.1

## 7.1.0

### Minor Changes

- [#419](https://github.com/forinda/kick-js/pull/419) [`8bbf484`](https://github.com/forinda/kick-js/commit/8bbf484d0cbd1fb0abf5a55d21873bef41231e95) Thanks [@forinda](https://github.com/forinda)! - Live `kick/db` query telemetry in DevTools.
  - **`@forinda/kickjs-db`** now republishes every successful query to the DevTools event bus as **`db:query`** (`{ sql, parameters, durationMs, dialect }`), alongside the existing `db:slow-query` / `db:query-error`. Zero-overhead when no bus is wired (unchanged). The `db:query` event is added to the `KickDevtoolsEventRegistry` augmentation (`@forinda/kickjs-db/devtools-events`).
  - **`@forinda/kickjs-devtools`** gains a **Database** tab: a live recent-query table (time, dialect, duration with slow-query highlight, rows, SQL/error) with SQL filter and headline counters (queries / errors / slow / avg duration). It subscribes to `db:query` (successes) and `db:query-error` (failures) on the shared bus.

- [#420](https://github.com/forinda/kick-js/pull/420) [`02fc80e`](https://github.com/forinda/kick-js/commit/02fc80e54a00b522800b2ae385b1588505815b14) Thanks [@forinda](https://github.com/forinda)! - DevTools dashboard: lean, space-efficient redesign
  - **Grouped resizable sidebar** replaces the horizontal tab strip. Tabs are
    organised into collapsible sections (Overview · Runtime · Architecture ·
    Data & Jobs · Activity). Drag the divider to resize; width and collapsed
    groups persist across reloads.
  - **Density control** (Small / Medium / Large) scales the whole dashboard's
    spacing and font size from one lever. Defaults to **Small** to maximise data
    on screen.
  - **Settings gear menu** in the header — a discoverable home for the density
    control (and future preferences), with an outside-click / Esc dismiss.

- [#415](https://github.com/forinda/kick-js/pull/415) [`7864609`](https://github.com/forinda/kick-js/commit/786460934ac035a3d591d7b80d49cdfba6a64a1d) Thanks [@forinda](https://github.com/forinda)! - DevTools now surfaces the active HTTP runtime and reports uptime correctly.
  - **`Application.getActiveRuntime()`** (new) — returns `{ name, capabilities }` for the active engine (`express` / `fastify` / `h3`), so tooling can show which runtime an app runs on.
  - **DevTools `/health`** includes `runtime`; **`/runtime`** includes a `process` block (`nodeVersion`, `pid`, `platform`, `arch`, `runtime`) — the Runtime tab now shows a strip making explicit that the memory / CPU / event-loop stats are for **this Node process** (the one running your app), with the engine, Node version, platform, and pid.
  - **Uptime fix** — uptime was derived from a timestamp reset in `beforeMount`, which re-runs on every HMR rebuild / dev re-bootstrap and pinned it near `0s`. It now reads `process.uptime()`, which is monotonic from process start and survives reloads.

### Patch Changes

- [#415](https://github.com/forinda/kick-js/pull/415) [`5ba703f`](https://github.com/forinda/kick-js/commit/5ba703f3aca4b6c203d7f976cb738fe28df6e0a2) Thanks [@forinda](https://github.com/forinda)! - Upgrade the DevTools dashboard SPA to Tailwind CSS 4.3.1 and rebuild the shipped `public/spa` assets so consumers get the current build.

- Updated dependencies []:
  - @forinda/kickjs-devtools-kit@7.0.0

## 7.0.0

### Patch Changes

- [#379](https://github.com/forinda/kick-js/pull/379) [`7528356`](https://github.com/forinda/kick-js/commit/75283569d8f142af7c9931a90958c611b478c906) Thanks [@forinda](https://github.com/forinda)! - Migrate the devtools adapter off the raw Express `app` / `Router` onto the engine-agnostic `ctx.http` facade (final M2 adapter). A thin local `router` shim forwards `.get` / `.post` / `.use` to `ctx.http.route` / `ctx.http.use`, so every dashboard handler — the ~20 JSON routes, the SSE streams, the heap-snapshot download, the static dashboard, and the token guard — is kept verbatim. Registration order is preserved and the guard still sees router-relative `req.path` (the facade scopes it to `basePath`, and Express strips the prefix), so behavior is unchanged under the default Express runtime. `ctx.app` is still used only as the documented escape hatch for `__kickApp` (topology needs the live Application instance).

- Updated dependencies []:
  - @forinda/kickjs-devtools-kit@7.0.0

## 7.0.0-alpha.0

### Patch Changes

- [#379](https://github.com/forinda/kick-js/pull/379) [`7528356`](https://github.com/forinda/kick-js/commit/75283569d8f142af7c9931a90958c611b478c906) Thanks [@forinda](https://github.com/forinda)! - Migrate the devtools adapter off the raw Express `app` / `Router` onto the engine-agnostic `ctx.http` facade (final M2 adapter). A thin local `router` shim forwards `.get` / `.post` / `.use` to `ctx.http.route` / `ctx.http.use`, so every dashboard handler — the ~20 JSON routes, the SSE streams, the heap-snapshot download, the static dashboard, and the token guard — is kept verbatim. Registration order is preserved and the guard still sees router-relative `req.path` (the facade scopes it to `basePath`, and Express strips the prefix), so behavior is unchanged under the default Express runtime. `ctx.app` is still used only as the documented escape hatch for `__kickApp` (topology needs the live Application instance).

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78)]:
  - @forinda/kickjs@5.18.0-alpha.0
  - @forinda/kickjs-devtools-kit@7.0.0-alpha.0

## 6.0.0

### Patch Changes

- Updated dependencies []:
  - @forinda/kickjs-devtools-kit@6.0.0

## 6.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0
  - @forinda/kickjs-devtools-kit@6.0.0-alpha.0

## 5.3.2

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

- Updated dependencies [[`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8)]:
  - @forinda/kickjs-devtools-kit@5.4.1

## 5.3.1

### Patch Changes

- [#267](https://github.com/forinda/kick-js/pull/267) [`04cd61d`](https://github.com/forinda/kick-js/commit/04cd61d2d932ea3d2a642afc72e84bc80ee28907) Thanks [@forinda](https://github.com/forinda)! - deps: move `ws` from `dependencies` to `peerDependencies` in both packages

  Both `@forinda/kickjs-ws` and `@forinda/kickjs-devtools` shipped `ws@^8.20.1` as a hard `dependency`. Adopters who already had `ws` installed (very common — it's used directly, through `socket.io`, through `undici`, through tons of other libs) could end up with two copies in `node_modules`, which breaks `instanceof WebSocket` checks and confuses some bundlers.

  Both packages now declare `ws` as a `peerDependencies` entry at `^8.0.0`. `ws@^8.20.1` stays in `devDependencies` so the workspace install/build/test still resolves a copy. Modern package managers auto-install peers (pnpm 8+ with `auto-install-peers=true`, npm 7+), so most adopters need no action; pnpm strict-mode users add `ws` to their dependencies explicitly.

- Updated dependencies []:
  - @forinda/kickjs-devtools-kit@5.4.0

## 5.3.0

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

### Patch Changes

- Updated dependencies [[`9f1e90e`](https://github.com/forinda/kick-js/commit/9f1e90e00160dfb3801e8bac451ace0aa7b3f37f)]:
  - @forinda/kickjs-devtools-kit@5.4.0

## 5.2.3

### Patch Changes

- [#238](https://github.com/forinda/kick-js/pull/238) [`98f9ef0`](https://github.com/forinda/kick-js/commit/98f9ef08c787799a051fd62c1db5ab03d844a5b3) Thanks [@forinda](https://github.com/forinda)! - fix(devtools): surface every peer adapter on `/_debug/health` + Overview

  Two related bugs caused the DevTools Overview > Health card to list
  **only** `DevToolsAdapter` even when the app booted with several
  adapters:
  - `adapterStatuses` was only ever written in `beforeMount`/`shutdown`
    for the DevTools adapter itself — peers were never added, so the
    `/_debug/health` JSON returned `adapters: { DevToolsAdapter: 'running' }`
    regardless of how many other adapters were registered.
  - The Overview > Health card's Adapters accordion defaulted to
    collapsed, hiding the list further.

  The fix seeds `adapterStatuses` from `getPeerAdapters()` in `afterStart`
  (every mounted peer appears as `running`), refreshes each entry from
  `peer.onHealthCheck()` when present at request time so the status is
  live rather than a frozen boot snapshot, and defaults the Overview
  accordion to open. No public-API change.

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

- Updated dependencies [[`4eebd43`](https://github.com/forinda/kick-js/commit/4eebd43f259c1d5b7214acd46efc6c6d277ee82f)]:
  - @forinda/kickjs-devtools-kit@5.3.2

## 5.2.2

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

- Updated dependencies [[`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e)]:
  - @forinda/kickjs-devtools-kit@5.3.1

## 5.2.1

### Patch Changes

- [#161](https://github.com/forinda/kick-js/pull/161) [`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98) Thanks [@forinda](https://github.com/forinda)! - Import `DEVTOOLS_BUS` from the new `@forinda/kickjs-devtools-kit/bus/token` subpath instead of `/bus`. The SPA bundle drops from **1025 kB to 92 kB** now that the framework runtime is no longer transitively pulled through the bus re-export.

  Test fix: vitest aliases switched to anchored regex so longer subpaths match before shorter ones (the previous string-prefix alias rewrote `/bus/token` into `bus.ts/token` and threw `ENOTDIR`).

- Updated dependencies [[`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98)]:
  - @forinda/kickjs-devtools-kit@5.3.0
