# Spec: KickJS platform improvements — devtools, dev server, typegen

> Status: Draft v1
> Date: 2026-04-27
> Owner: @forinda
> Scope: framework-wide (not DB-specific). Sibling to [`./spec-auto-schema-typing.md`](./spec-auto-schema-typing.md).
> Source: [`./tanstack-patterns.md`](./tanstack-patterns.md) — patterns proven in `/home/forinda/dev/open-source/{tanstack-devtools,tanstack-router,tanstack-query}`.

## 1. Problem statement

KickJS today ships three separate developer-facing surfaces that don't compose:

1. **DevTools** at `/_debug` — first-party tabs registered via `defineDevtoolsTab`. Every
   adapter (`db`, `prisma`, `drizzle`, `queue`, `cron`, `swagger`) ships its own tab.
   No standard contract for third-party tabs. UI framework choice (Solid? React?) is
   currently coupled to the package.
2. **Dev server** (`@forinda/kickjs-vite`) — Vite plugin handling HMR, single-port
   dev, typegen watcher. Diagnostics surface to terminal. No structured way for
   adapter packages to contribute their own dev-time diagnostics (e.g., kickjs-db
   wants to flag pending migrations in the dev banner; today it can only `console.log`).
3. **Typegen** (`kick typegen`) — emits `KickRoutes`, `KickEnv`, `KickAssets` to
   `.kickjs/types/`. Output set is hardcoded; adopter packages can't contribute
   additional augmentations (e.g., kickjs-db wants to ship `KickDbSchema`; OpenAPI,
   forms, RPC etc. all want their own slice).

Each surface is solid in isolation. None of them have an extension contract. **Every
new adapter package gets stuck reimplementing parts of all three.**

The TanStack project solved the same shape of problem by:

- One devtools shell hosting many plugins via `(el, props) => void`.
- Multi-tier event bus (BroadcastChannel + WebSocket + SSE) so any tool can publish
  events any other tool can subscribe to.
- Vite AST plugin that strips devtools imports + JSX from production builds.
- Build-time codegen that emits a single ambient `routeTree.gen.ts` consumed via the
  `Register` interface augmentation pattern.

This spec ports those ideas to KickJS as **three independent improvements** with one
cross-cutting integration story.

## 2. Goals

1. **Single plugin contract** for devtools tabs — `(el, props) => void`. Framework-
   agnostic. Adapter packages can ship custom tabs without us shipping their UI
   framework.
2. **One event bus** for cross-tab + server→client communication. Replaces the
   currently-undocumented "everyone uses console.log" approach.
3. **Pluggable typegen** — `kick.config.ts: typegen.plugins` array. Adapter packages
   register augmentation generators. Output goes to `.kickjs/types/<plugin>.d.ts`.
4. **Production-safe by construction** — Vite plugin that AST-strips the devtools
   shell + tab imports + event-bus client at build time. Adopter never ships dev
   tooling to prod by accident.
5. **Backwards compatible.** Existing `defineDevtoolsTab` consumers keep working;
   the new contract is additive.

## 3. Non-goals

- **Not** a redesign of `defineAdapter` / `definePlugin`. Those are stable.
- **Not** a replacement for Vite. We continue to ship `@forinda/kickjs-vite` as a
  Vite plugin; this spec extends what it does, doesn't fork it.
- **Not** a remote / multi-machine devtools (Sentry-style). Localhost dev only.
- **No new package for the event bus** — lives in `@forinda/kickjs-devtools-kit`
  alongside `defineDevtoolsTab`.

## 4. Subsystem A — DevTools plugin contract

### 4.1 Current shape

```ts
// @forinda/kickjs-devtools-kit (M1)
export interface DevtoolsTab {
  id: string
  title: string
  icon?: string
  // The package authors have to know our SPA shell and write a Solid component
  // that renders into our shell. Coupling: every adapter package depends on
  // a Solid version we pick.
  render: (props: TabProps) => SolidComponent
}

export function defineDevtoolsTab(spec: DevtoolsTab) { ... }
```

### 4.2 Proposed shape

Mirror TanStack's `(el, props) => void` contract. The plugin author owns rendering
into a raw `HTMLElement` they're handed — Solid, React, vanilla DOM, lit-html, all
work. The host shell never imports a UI framework.

```ts
// @forinda/kickjs-devtools-kit (M2)
export interface DevtoolsTab<TProps = TabProps> {
  /** Stable id — used for routing, persistence, hotkeys. */
  id: string
  /** Display name. Function form lets adapter render a typed badge/icon HTML. */
  name: string | ((el: HTMLElement) => void)
  /** Optional badge: count of unread events, error indicator, etc. */
  badge?: () => string | number | null

  /**
   * Mount the tab content into the given element. Called once per tab open;
   * the returned cleanup runs on unmount. Plugin owns its own framework choice.
   */
  render: (el: HTMLElement, props: TProps) => void | (() => void)

  /** Tab is open by default if no other tab has been visited yet. */
  defaultOpen?: boolean
}

export function defineDevtoolsTab<TProps = TabProps>(spec: DevtoolsTab<TProps>) {
  return spec
}
```

`TabProps` is a stable surface:

```ts
export interface TabProps {
  bus: KickEventBus // see §5
  config: TabRuntimeConfig // theme, hotkeys, panel size — synced from host
  query: URLSearchParams // for sharable links into a tab's state
}
```

### 4.3 What stays the same

- The first-party tabs we already ship (`db`, `swagger`, etc.) keep working — their
  package internally migrates from the `SolidComponent` return to writing into the
  `HTMLElement`. Migration is per-tab, not per-host.
- The host shell (`@forinda/kickjs-devtools` runtime app) gets simpler — it's now
  framework-agnostic, just a registry + event bus + DOM portal.

### 4.4 Plugin auto-discovery vs explicit listing

TanStack uses **explicit lists** — adopters pass `plugins: [...]` to the devtools
shell. KickJS already auto-discovers tabs via DI: every registered adapter that ships
a `devtoolsTabs()` callback contributes. **Keep that** — it's better than TanStack's
manual plugins array because we already have the DI substrate.

But add a `kick.config.ts: devtools.plugins?: DevtoolsTab[]` for adopters who want to
register their own one-off tabs without an adapter package. Both paths feed the same
registry.

## 5. Subsystem B — Multi-tier event bus

### 5.1 Today

There isn't one. Adapter packages either log to terminal, push to a private
WebSocket, or shove state into a global. Inconsistent.

### 5.2 TanStack pattern

`@tanstack/devtools` ships an event bus with three transports:

1. **BroadcastChannel** — cross-tab (open `/_debug` in two tabs, see same state).
2. **WebSocket** — server→client (HMR-driven events, slow query log, etc).
3. **SSE fallback** — when WS is blocked (corporate proxies, some prod-like dev envs).

Events are `{ type, payload, pluginId? }`. Vite plugin injects globals
(`__TANSTACK_DEVTOOLS_PORT__`, `_HOST_`, `_PROTOCOL_`) so the client knows where to
connect.

### 5.3 Proposed for KickJS

```ts
// @forinda/kickjs-devtools-kit (M2)
export interface KickDevtoolsEvent<T = unknown> {
  type: string // e.g. 'db:slow-query', 'http:request'
  payload: T
  pluginId?: string // emitted-by tab; receivers filter
  ts: number // server-emit time
}

export interface KickEventBus {
  emit<T>(event: KickDevtoolsEvent<T>): void
  on<T>(type: string, handler: (e: KickDevtoolsEvent<T>) => void): () => void
  /** Wildcard subscriber — sees every event; for the activity-log tab. */
  onAny(handler: (e: KickDevtoolsEvent) => void): () => void
}
```

Two implementations:

- **Browser** — wraps `BroadcastChannel('kick-devtools')` for cross-tab + a WebSocket
  client for server→client. Lazy-connects on first subscriber.
- **Server** — wraps the express app's WebSocket route (mounted at `/_debug/events`)
  - an in-process EventEmitter for adapter→adapter on the same node.

Adapter packages publish events without caring who subscribes:

```ts
// inside @forinda/kickjs-db's runtime
this.bus.emit({
  type: 'db:slow-query',
  payload: { sql, params, durationMs },
  pluginId: 'db',
  ts: Date.now(),
})
```

The DevTools `db` tab subscribes:

```ts
const off = props.bus.on<SlowQueryPayload>('db:slow-query', (e) => {
  // append to the slow-query table
})
```

A separate `activity-log` tab uses `onAny` to render the timeline.

### 5.4 Type-safe events via `Register`

Mirror the same `Register` augmentation pattern proposed in
[`./spec-auto-schema-typing.md`](./spec-auto-schema-typing.md) §7:

```ts
// adapter package augments
declare module '@forinda/kickjs-devtools-kit' {
  interface KickDevtoolsEventRegistry {
    'db:slow-query': { sql: string; params: unknown[]; durationMs: number }
    'db:migration-applied': { id: string; durationMs: number }
  }
}
```

Then `bus.emit` and `bus.on` are typed end-to-end:

```ts
bus.on('db:slow-query', (e) => e.payload.sql) // payload typed
bus.emit({ type: 'unknown', payload: 1 }) // TS error: 'unknown' not in registry
```

Same trick TanStack Query uses for `dataTagSymbol`-tagged keys. Same trick KickJS
already uses for `KickRoutes` / `KickEnv` augmentations.

### 5.5 Persistence

Mirror TanStack:

- `localStorage['KICK_DEVTOOLS_SETTINGS']` — theme, panel position, hotkeys, height
- `localStorage['KICK_DEVTOOLS_STATE']` — active tab, persistOpen, recent events buffer
  size

Stale plugin IDs are auto-pruned on next load (a new adapter package showing up
doesn't crash the shell).

## 6. Subsystem C — Pluggable codegen / typegen

### 6.1 Today

`kick typegen` walks the project, emits `.kickjs/types/{routes.d.ts, env.d.ts,
assets.d.ts}`. Hardcoded set of generators in `@forinda/kickjs-cli`. Adapter packages
can't contribute.

### 6.2 What we want

Three things:

- **A first-class plugin contract for typegen.** Adapter packages register a
  generator; `kick typegen` runs each generator and writes its output to a
  predictable file under `.kickjs/types/`.
- **One conventional `Register` augmentation interface.** The DB schema spec already
  proposes `declare module '@forinda/kickjs-db' { interface Register { db: ... } }`.
  Generalise it: every package that wants to be auto-typed exposes its own
  `Register` interface.
- **Watcher integration.** Vite plugin re-runs the affected generator(s) when their
  inputs change. Already true for routes/env/assets; should be uniform for plugins.

### 6.3 The plugin contract

```ts
// @forinda/kickjs-cli/src/typegen/plugin.ts (M2)
export interface TypegenPlugin {
  /** Stable id — used as filename: .kickjs/types/${id}.d.ts */
  id: string

  /** Files this plugin watches. Vite plugin re-runs the generator on change. */
  inputs: string[] // glob patterns

  /**
   * Compute the augmentation source. Called on first run + on any input change.
   * Return null to skip emission (e.g. no schema file present).
   */
  generate(ctx: TypegenContext): Promise<string | null>
}

export interface TypegenContext {
  cwd: string
  config: KickConfig
  /** Helper to resolve and import a TS file from the adopter project. */
  importTs<T = unknown>(absPath: string): Promise<T>
  /** Write a side-file (rare; most plugins return source from generate()). */
  writeFile(relPath: string, contents: string): Promise<void>
  log: TypegenLogger
}
```

### 6.4 Built-in plugins (refactored, not new)

The current generators become plugins:

| Plugin id                                       | Purpose                                                                                        | Inputs             | Output                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------ | --------------------------- |
| `kick/routes`                                   | Walks `src/modules/**/*.controller.ts` for `@Get`/`@Post`/etc, emits `KickRoutes` augmentation | `src/modules/**`   | `.kickjs/types/routes.d.ts` |
| `kick/env`                                      | Reads `defineEnv` schema, emits `KickEnv` augmentation                                         | `src/env.ts`       | `.kickjs/types/env.d.ts`    |
| `kick/assets`                                   | Walks `src/templates/**`, emits `KickAssets` augmentation                                      | `src/templates/**` | `.kickjs/types/assets.d.ts` |
| `kick/db` _(new — see auto-schema-typing spec)_ | Reads `db.schemaPath`, emits `KickDbSchema` + `Register['db']`                                 | `src/db/schema.ts` | `.kickjs/types/db.d.ts`     |

After the refactor, **none of the four are special-cased in CLI source.** They're
plugins shipped by `@forinda/kickjs-cli` and registered by default. Removing one is
just removing it from the default list; replacing with a custom one is one config
edit.

### 6.5 Adopter usage

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'
import { openApiTypegen } from '@forinda/kickjs-swagger/typegen'
import { graphqlTypegen } from 'some-community-package/typegen'

export default defineConfig({
  typegen: {
    // Default plugins always run; this is purely additive.
    plugins: [openApiTypegen(), graphqlTypegen()],
  },
})
```

### 6.6 Watcher integration with `@forinda/kickjs-vite`

The Vite plugin reads the resolved plugin list, watches each plugin's `inputs` glob,
and triggers the corresponding generator on change. Single watcher, multiple
generators. No per-plugin watcher to manage.

This stays compatible with the current single-port HMR story — generated files land
under `.kickjs/types/` which TS picks up via the project's `tsconfig.json` `include`.

### 6.7 Output stability + idempotency

Each generator emits a banner:

```ts
/* AUTO-GENERATED by kick typegen — do not edit. Plugin: kick/routes. */
```

CI can fail if a generator's output drifts (`pnpm kick typegen --check`). Same model
as Prettier's `--check`.

### 6.8 The `Register` convention

Every package that exposes typed augmentations declares an empty `Register`
interface in its public API:

```ts
// @forinda/kickjs (core)
export interface Register {}
//   adopter: declare module '@forinda/kickjs' { interface Register { app: typeof app } }

// @forinda/kickjs-db
export interface Register {}
//   adopter: declare module '@forinda/kickjs-db' { interface Register { db: typeof dbClient } }

// @forinda/kickjs-devtools-kit
export interface KickDevtoolsEventRegistry {}
//   adapter: declare module '@forinda/kickjs-devtools-kit' { interface KickDevtoolsEventRegistry { 'db:slow-query': ... } }
```

Same shape across every package. New adopter learns it once. The codegen plugins
(§6.4) emit the augmentation when adopters opt into typegen.

## 7. Production safety — Vite AST strip

### 7.1 Problem

Today, importing `@forinda/kickjs-devtools` in `src/index.ts` pulls the entire
DevTools UI bundle into the production build. Adopters either guard with
`if (process.env.NODE_ENV === 'development')` (works at runtime, doesn't tree-shake
the imports) or skip the integration entirely.

### 7.2 TanStack pattern (`@tanstack/devtools-vite`)

Babel transform during prod build:

- Removes `import` statements from `@tanstack/react-devtools`, `@tanstack/devtools`,
  `@tanstack/router-devtools`, etc.
- Removes JSX `<TanStackDevtools />` elements + unused references.
- Optional `requireUrlFlag: 'tanstack-devtools'` so devtools only mount when URL
  contains the flag (handy for staged-rollout debugging).

Runs only when `command === 'build'` and `mode === 'production'`. Dev server
unaffected.

### 7.3 Proposed for KickJS

Ship as **part of `@forinda/kickjs-vite`** (not a new package), opt-in via a config
flag:

```ts
// vite.config.ts
import { kickjs } from '@forinda/kickjs-vite'

export default defineConfig({
  plugins: [
    kickjs({
      devtools: {
        stripOnBuild: true, // default true
        requireUrlFlag: 'kickjs-devtools', // optional
      },
    }),
  ],
})
```

Stripped imports cover:

- `@forinda/kickjs-devtools` (host shell)
- `@forinda/kickjs-devtools-kit` (plugin contract + bus client)
- Any tab module pattern-matching `**/*.devtools.{ts,tsx}` (convention for adopter-
  side dev-only modules)

Implementation: Babel + `@babel/plugin-transform-typescript` to handle TS without
compilation overhead. Reuse the AST walker pattern TanStack ships verbatim — small
amount of code, well-tested upstream.

### 7.4 Belt-and-suspenders runtime guard

In addition to the AST strip, runtime keeps the existing `NODE_ENV === 'production'`
check on the DevTools mount endpoint. If both fail (someone deploys with
`NODE_ENV=development` and forgot the strip), endpoints still 404 in any prod-like
runtime. Two layers, fail-safe.

## 8. Cross-cutting integration story

The three subsystems (devtools / event bus / typegen) compose:

```
  ┌────────────────────────────────────────────────────────────────────┐
  │                  Adopter app — runs `kick dev`                      │
  └───────┬────────────────────────────────────────────────────────────┘
          │
          ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │  @forinda/kickjs-vite Vite plugin                                  │
  │   ├── HMR (existing)                                                │
  │   ├── typegen runner (composed of registered TypegenPlugins)        │
  │   ├── DevTools mount (in dev only — AST-stripped on build)          │
  │   └── Diagnostics surface (writes to bus AND terminal)              │
  └───────┬─────────────────────────┬───────────────────────────────────┘
          │                         │
          │  ws /_debug/events      │ writes .kickjs/types/*.d.ts
          ▼                         ▼
  ┌──────────────────────┐  ┌─────────────────────────┐
  │  Browser DevTools    │  │  TS language server      │
  │  /_debug             │  │  (consumes augmentations)│
  │   ├── tab: db        │  └─────────────────────────┘
  │   ├── tab: routes    │
  │   ├── tab: queue     │
  │   └── …              │
  │                      │
  │   ↕ KickEventBus     │  (BroadcastChannel cross-tab,
  │                      │   WebSocket to server above)
  └──────────────────────┘
```

Concrete examples:

1. **Pending migration banner.** `@forinda/kickjs-db` emits
   `db:pending-migrations` on `kickDbAdapter.beforeStart()`. The dev server's
   diagnostic surface subscribes — prints to terminal AND opens the `db` tab in the
   active devtools session. Adopter sees both immediately.
2. **HMR-aware schema change.** Adopter edits `src/db/schema.ts`. Vite watcher
   triggers `kick/db` typegen plugin. New `.kickjs/types/db.d.ts` lands. Bus emits
   `typegen:complete { plugin: 'kick/db' }`. The `db` devtools tab's `Schema` view
   refreshes its tree without a page reload.
3. **Custom adapter ships its own tab.** A community `@example/kickjs-redis`
   package ships:
   - A `defineDevtoolsTab` consumer that mounts a Solid component into the host
     shell.
   - A `TypegenPlugin` that emits `KickRedisChannels` augmentation.
   - Events on `bus`: `redis:command`, `redis:keyspace-event`.
     Adopter installs the package, gets all three with no manual wiring.

## 9. Implementation milestones

Each milestone is shippable independently. The order respects dependencies — the
plugin contract underlies the bus, the bus underlies typegen integration.

### M2.A — DevTools plugin contract refactor (~1 week)

- Refactor `defineDevtoolsTab` to `(el, props) => void` shape.
- Migrate first-party tabs (`db`, `swagger`, `queue`, `cron`, `routes` — whichever
  exist) to the new contract.
- Migration guide for community tabs.
- Tests: render-into-DOM smoke tests in `@forinda/kickjs-devtools-kit`.

### M2.B — Multi-tier event bus (~1 week)

- Implement browser-side `KickEventBus` (BroadcastChannel + WS client).
- Implement server-side bus + `/_debug/events` WS route.
- Type-level `KickDevtoolsEventRegistry` augmentation.
- Wire first-party adapters to publish events (kickjs-db slow query, migrations,
  request lifecycle).
- Tests: cross-tab smoke, WS reconnect, lazy-connect on first subscriber.

### M2.C — Vite AST strip (~3 days)

- Babel transform plugin in `@forinda/kickjs-vite`.
- `requireUrlFlag` option.
- Tests: build a fixture project, assert the resulting bundle has zero
  `kickjs-devtools` references.

### M2.D — Pluggable typegen (~1 week)

- Refactor existing generators to the `TypegenPlugin` contract.
- Resolve plugin list from `kick.config.ts: typegen.plugins` + defaults.
- Watcher integration in the Vite plugin.
- `--check` mode for CI drift detection.
- Reference plugin: `kick/db` (replaces inline DB typegen from auto-schema-typing
  spec).

### M2.E — Documentation pass (~3 days)

- New guide page: `docs/guide/devtools-plugins.md`.
- New guide page: `docs/guide/event-bus.md`.
- New guide page: `docs/guide/typegen-plugins.md`.
- Update `docs/guide/devtools.md` with the new plugin contract.
- Update `docs/guide/typegen.md` with the plugin model.
- Adapter author migration notes in `AGENTS.md`.

**Total: ~3.5 weeks** for M2 platform improvements. Tracks alongside M2 DB work
(M2-S1 type tightening, M2-S6 lifecycle hooks) — they share the `Register` pattern
and the event bus.

## 10. Open questions

### 10.1 UI framework choice for the host shell

After the plugin contract refactor, the shell (`@forinda/kickjs-devtools`) is
framework-agnostic in the sense that it doesn't constrain plugin authors. But the
shell itself still has to be written in _something_. Options:

- **Vanilla DOM + lit-html / hyperscript.** Smallest bundle, no framework deps,
  matches "the shell never imports a UI framework" pretext.
- **Solid.js.** TanStack's choice. Reactive primitives, small footprint.
- **Status quo (whatever we're using now).** Defer the question.

Lean: vanilla DOM for the shell chrome, plugin authors pick whatever for their tab.

### 10.2 Event-bus backpressure

Subscribers can be slow. Server-side adapters publishing high-volume events
(e.g., every HTTP request) could overwhelm the WS channel. Sampling? Buffered
batching? Need to define before shipping a high-volume publisher.

Lean: 100ms debounced batches at the WS boundary; subscribers receive arrays.

### 10.3 Codegen plugin sandboxing

A typegen plugin runs `importTs(adopterFile)` to read source — so it can crash the
typegen run by `throw`-ing. Should we sandbox? Worker thread? Or trust plugins
declared in `kick.config.ts`?

Lean: trust + good error reporting. Plugins are explicitly opted into.

### 10.4 Hot-reload of the plugin list itself

If the adopter edits `kick.config.ts: typegen.plugins`, the Vite plugin currently
needs a server restart. Watching `kick.config.ts` and re-resolving the plugin list
is feasible but tricky (what if a plugin's `generate()` is in flight?).

Lean: defer. Restart on `kick.config.ts` edits; document it.

### 10.5 Where does the dev-server diagnostics surface live?

The integration story (§8) imagines a "diagnostics surface" that bridges terminal
and devtools. Today this is partially handled by Pino + nice CLI prefixes. The
question is whether to ship a structured "diagnostic" type:

```ts
interface KickDiagnostic {
  level: 'info' | 'warn' | 'error'
  message: string
  source: string // 'kickjs-db', 'kickjs-vite', etc
  fixSuggestion?: string
  bus?: { type: string; payload: unknown } // optional bus event
}
```

…and expose it as a CLI command (`kick check`) plus an event bus topic. Defer the
naming + shape to the implementation milestone.

## 11. Summary

Three independent subsystems, each landing the same pattern at a different layer:

| Subsystem                | Pattern                                        | Adopter benefit                               |
| ------------------------ | ---------------------------------------------- | --------------------------------------------- |
| DevTools plugin contract | `(el, props) => void`                          | Tabs from any adapter, any framework          |
| Multi-tier event bus     | Typed events via `Register` augmentation       | Cross-tab + server→client comms               |
| Pluggable typegen        | `TypegenPlugin` contract + default plugin list | Every adapter contributes typed augmentations |
| AST strip on prod build  | Babel transform                                | Zero risk of dev tooling in prod              |

All four are additive — no breaking change. All four follow the same conventions
already used elsewhere in KickJS (`Register` augmentation, slash-delimited token
namespacing, `defineX` factory pattern, callback-based extension over inheritance).

Implementation: ~3.5 weeks total, breaks into five sub-milestones each shippable
independently. Sequenced after M2-S1 type tightening so the `Register` augmentation
shape is locked in first.

Cumulatively, this is what turns KickJS from "a framework with adapters" into "a
framework whose adapters compose at every layer of the developer experience."

---

## Appendix A — relationship to other specs

| Spec                                                           | Owns                             | Depends on this                                                                                  |
| -------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`./spec-auto-schema-typing.md`](./spec-auto-schema-typing.md) | DB schema → typed Kysely surface | The `Register` augmentation pattern (§6.8) and `kick/db` typegen plugin (§6.4) are the same idea |
| [`./architecture.md`](./architecture.md)                       | kickjs-db architecture           | DevTools tab proposed there is an instance of §4's plugin contract                               |
| [`./tanstack-patterns.md`](./tanstack-patterns.md)             | Research notes                   | This spec is the actionable version of "Borrow now" §1, §2, §3                                   |
| [`./m1-plan.md`](./m1-plan.md)                                 | M1 implementation                | M1 is done; this spec is M2 territory                                                            |

Concrete: when M2-S1 lands the schema typing tightening, it lands a _single
TypegenPlugin_ implementation (`kick/db`). The plugin contract (§6.3) needs to ship
**before or with** M2-S1, not after — so the DB plugin lands as a participant in
the plugin system, not as a special case to refactor later.

Plan: M2.D (pluggable typegen) lands first or in parallel with M2-S1. The other
three improvements (devtools contract, event bus, AST strip) are independent of M2
DB work and can land in any order.
