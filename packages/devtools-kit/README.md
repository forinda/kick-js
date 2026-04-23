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

## See also

- [architecture.md §23](https://github.com/forinda/kick-js/blob/main/architecture.md#23-devtools-deep-introspection-half-baked) — design rationale for v2.
- [`@forinda/kickjs-devtools`](https://www.npmjs.com/package/@forinda/kickjs-devtools) — the runtime that consumes this kit and serves the panel.
