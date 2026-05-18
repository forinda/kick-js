---
'@forinda/kickjs': minor
'@forinda/kickjs-devtools': minor
'@forinda/kickjs-devtools-kit': minor
---

feat(devtools): render full introspect snapshot + surface module-level contributors with intact dependsOn

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
