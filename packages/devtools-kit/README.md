# @forinda/kickjs-devtools-kit

Types, RPC envelopes, runtime sampler, and memory analyzer for KickJS DevTools (architecture.md §23).

## Install

```bash
pnpm add @forinda/kickjs-devtools-kit
```

## What's in the box

- **`IntrospectionSnapshot`** — the contract every plugin/adapter implements via the `introspect()` slot on `defineAdapter()` / `definePlugin()`.
- **`defineDevtoolsTab(opts)`** — declarative tab descriptor (iframe / launch / html views) that plugins ship to surface in the DevTools panel.
- **`RuntimeSampler`** — Tier 1 monitoring (heap, CPU, event-loop, GC) with a ring buffer of recent snapshots for sparkline rendering.
- **`MemoryAnalyzer`** — heap-growth trend (linear regression), GC reclaim ratio, active-handle inventory, composite leak-warning severity.
- **`RpcRequest` / `RpcResponse`** — transport-agnostic envelope types used by every DevTools RPC channel.
- **`PROTOCOL_VERSION`** — wire-format version stamped on every snapshot so future shape changes don't crash old panels.

## Subpath exports

The package is split across focused entry points so browser bundles (and any consumer that doesn't need server-side APIs) only pull what they actually use:

| Subpath                                  | Use it for                                                                      | Pulls in `@forinda/kickjs`? |
| ---------------------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| `@forinda/kickjs-devtools-kit`           | `IntrospectionSnapshot`, `PROTOCOL_VERSION`, `defineDevtoolsTab`, RPC envelopes | no                          |
| `@forinda/kickjs-devtools-kit/runtime`   | `RuntimeSampler`, `MemoryAnalyzer`                                              | no                          |
| `@forinda/kickjs-devtools-kit/types`     | shared type-only re-exports                                                     | no                          |
| `@forinda/kickjs-devtools-kit/bus`       | `KickEventBus` types, `createInMemoryBus`, `createBrowserBus`                   | no                          |
| `@forinda/kickjs-devtools-kit/bus/token` | `DEVTOOLS_BUS` DI token (server-side only)                                      | yes                         |

The bus DI token lives at its own subpath because `createToken` from `@forinda/kickjs` transitively pulls the framework runtime. Browser SPAs and shared bus consumers import from `/bus`; server-side adapters/plugins that need to register or resolve the bus through DI import the token from `/bus/token`.

## Quick example — adapter integration

```ts
import { defineAdapter } from '@forinda/kickjs'
import { PROTOCOL_VERSION, type IntrospectionSnapshot } from '@forinda/kickjs-devtools-kit'

let activeWorkers = 0
let pendingJobs = 0

export const QueueAdapter = defineAdapter({
  name: 'QueueAdapter',
  build: (config) => ({
    middleware: () => [
      /* ... */
    ],
    introspect: (): IntrospectionSnapshot => ({
      protocolVersion: PROTOCOL_VERSION,
      name: 'QueueAdapter',
      kind: 'adapter',
      state: { strategy: config.strategy },
      tokens: { provides: ['kick/queue/Manager'], requires: [] },
      metrics: { activeWorkers, pendingJobs },
    }),
  }),
})
```

`introspect()` is called on demand by the DevTools topology endpoint. Keep it cheap (counters + flags) — anything that needs a DB round trip belongs behind a separate explicit RPC.

## Quick example — runtime monitoring

```ts
import { RuntimeSampler, MemoryAnalyzer } from '@forinda/kickjs-devtools-kit/runtime'

const sampler = new RuntimeSampler({ intervalMs: 1000, bufferSize: 60 })
const analyzer = new MemoryAnalyzer()

sampler.start()
analyzer.start()

// Later — in an RPC handler
const latest = sampler.latest() // most recent RuntimeSnapshot
const window = sampler.history() // last 60 snapshots
const health = analyzer.health(window) // composite memory health signal
```

## Why a separate kit package

Plugin authors integrating with DevTools should not need to take a dependency on the DevTools runtime, the panel UI, or any HTTP / WebSocket transport. The kit ships only types + a tiny runtime (sampler + analyzer); zero runtime deps, no peer requirements except `@forinda/kickjs` itself.

## Recommended dependency shape (third-party plugins)

Framework-internal `@forinda/kickjs-*` adapters list this kit as a **regular `dependencies`** entry — releases are coordinated through Changesets, so the kit and its consumers ship matching versions and pnpm dedupes the ~1 KB type install automatically.

For **third-party plugins** the recommended shape is **peer-optional**:

```jsonc
{
  "peerDependencies": {
    "@forinda/kickjs-devtools-kit": ">=5.0.0",
  },
  "peerDependenciesMeta": {
    "@forinda/kickjs-devtools-kit": { "optional": true },
  },
  "devDependencies": {
    "@forinda/kickjs-devtools-kit": "^5.0.0",
  },
}
```

Why peer-optional:

- Adopters who don't use DevTools never install the kit — your plugin's `devtoolsTabs()` / `introspect()` methods become dead code, never invoked because the DevTools aggregator isn't mounted.
- Adopters who do use DevTools install the kit at the top of their dependency tree alongside `@forinda/kickjs-devtools` — version coordination is explicit and deduped.
- Your plugin still gets full type-checking via the `devDependencies` entry.

The `IntrospectionSnapshot.protocolVersion` field (currently `1`) means version skew across major bumps is wire-compatible — adopters mixing your plugin's pinned version with a newer kit will keep working as long as both report the same protocol version.

## See also

- [architecture.md §23](https://github.com/forinda/kick-js/blob/main/architecture.md#23-devtools-deep-introspection-half-baked) — design rationale for v2.
- [`@forinda/kickjs-devtools`](https://www.npmjs.com/package/@forinda/kickjs-devtools) — the runtime that consumes this kit and serves the panel.
