# @forinda/kickjs-devtools-kit

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
