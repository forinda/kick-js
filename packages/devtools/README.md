# @forinda/kickjs-devtools

Dev introspection dashboard — routes, DI container state, request metrics, p50/p95/p99 latency, error-rate alerts, dependency graph, SSE stream. Mounted under `/_debug` and gated by an auto-generated token.

## Install

```bash
kick add devtools
```

## Quick Example

```ts
import { bootstrap, getEnv } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    DevToolsAdapter({
      secret: getEnv('NODE_ENV') === 'production' ? undefined : false,
      exposeConfig: true,
      configPrefixes: ['APP_', 'NODE_ENV', 'PORT'],
    }),
  ],
})
```

Endpoints (token-gated unless `secret: false`): `/_debug/{routes,container,metrics,health,state,config,graph,stream,ws,queues}` — plus a Vue + Tailwind dashboard at `/_debug/`.

## Documentation

[forinda.github.io/kick-js/guide/devtools](https://forinda.github.io/kick-js/guide/devtools)

## License

MIT
