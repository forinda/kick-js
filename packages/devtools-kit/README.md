# @forinda/kickjs-devtools-kit

The contract between KickJS DevTools and the adapters and plugins it shows: `IntrospectionSnapshot`, `defineDevtoolsTab()`, the RPC envelope types, and the runtime sampler and memory analyzer. You need it only to make your own adapter or plugin visible in the `/_debug` panel.

## Install

```bash
pnpm add @forinda/kickjs-devtools-kit
```

For a third-party plugin, list it as an optional peer, so apps that don't run DevTools never install it.

## Quick example

```ts
import { defineAdapter } from '@forinda/kickjs'
import { PROTOCOL_VERSION, type IntrospectionSnapshot } from '@forinda/kickjs-devtools-kit'

let pendingJobs = 0

export const QueueAdapter = defineAdapter({
  name: 'QueueAdapter',
  build: () => ({
    // Called on demand by the panel: keep it to counters and flags.
    introspect: (): IntrospectionSnapshot => ({
      protocolVersion: PROTOCOL_VERSION,
      name: 'QueueAdapter',
      kind: 'adapter',
      state: {},
      metrics: { pendingJobs },
    }),
  }),
})
```

Subpaths keep browser bundles small. `/runtime` holds `RuntimeSampler` and `MemoryAnalyzer`, and `/bus` holds the event bus. The `DEVTOOLS_BUS` DI token lives at `/bus/token`, the one subpath that imports `@forinda/kickjs`.

## Documentation

- [DevTools](https://kickjs.app/guide/devtools)
- [Adapters](https://kickjs.app/guide/adapters) and [Plugins](https://kickjs.app/guide/plugins): the `introspect()` and `devtoolsTabs()` hooks

## License

MIT
