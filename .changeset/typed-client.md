---
'@forinda/kickjs-client': minor
'@forinda/kickjs-cli': minor
---

feat: `@forinda/kickjs-client` — typed fetch client (R3, closes the response-inference roadmap)

`kick typegen` now also emits a flat `KickRoutes.Api` map (`'GET /tasks/:id'`
keys referencing the controller route shapes). The new zero-dependency client
consumes it:

```ts
import { createClient } from '@forinda/kickjs-client'

const api = createClient<KickRoutes.Api>({ baseUrl: 'https://x/api/v1' })
const task = await api.get('/tasks/:id', { params: { id: '42' } })
//    ^ your handler's actual return type
```

- Paths, params and body constrained per verb at compile time; responses flow
  from return-value handlers via `InferHandlerResponse`
- Runtime-neutral (fetch/URL/Headers) — browsers, node, Bun, Deno, edge
- `KickClientError` carries status + parsed RFC 9457 problem body
- Injectable `fetch` — pass `createWebApp().fetch` for network-free tests
