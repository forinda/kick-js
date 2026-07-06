# @forinda/kickjs-client

Typed fetch client for [KickJS](https://kickjs.app/) APIs — end-to-end response
types powered by `kick typegen`'s `KickRoutes.Api` map.

```bash
pnpm add @forinda/kickjs-client
```

```ts
import { createClient } from '@forinda/kickjs-client'

const api = createClient<KickRoutes.Api>({ baseUrl: 'https://api.example.com/api/v1' })

const task = await api.get('/tasks/:id', { params: { id: '42' } })
//    ^ the handler's actual response type — inferred, not declared

const created = await api.post('/tasks', { body: { title: 'Ship it' } })
```

- **Paths + params + body typed** from the generated `KickRoutes.Api`; response
  types flow from your controller handlers (return-value style) via
  `InferHandlerResponse`.
- **Runtime-neutral**: fetch/URL/Headers only — browsers, node ≥ 20, Bun, Deno,
  edge workers. Zero dependencies.
- **Typed errors**: non-2xx throws `KickClientError` carrying the parsed body
  (RFC 9457 problem details when the server used `ctx.problem`).
- **Injectable fetch**: pass `{ fetch: app.fetch }` from `@forinda/kickjs/web`
  for network-free integration tests.

Docs: [kickjs.app/guide/typed-client](https://kickjs.app/guide/typed-client.html)
