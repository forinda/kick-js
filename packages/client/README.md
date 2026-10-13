# @forinda/kickjs-client

Typed fetch client for [KickJS](https://kickjs.app/) APIs — end-to-end response
types from the route map `kick typegen` generates.

```bash
pnpm add @forinda/kickjs-client
```

```ts
import { createClient } from '@forinda/kickjs-client'

// KickClientApi is ambient: with `typegen: { client: true }` in the server's
// kick.config.ts, list its .kickjs/types/kick__client.d.ts in the frontend
// tsconfig's `types`.
const api = createClient<KickClientApi.Api>({ baseUrl: 'https://api.example.com/api/v1' })

const task = await api.get('/tasks/:id', { params: { id: '42' } })
//    ^ the handler's actual response type — inferred, not declared

const created = await api.post('/tasks', { body: { title: 'Ship it' } })
```

`KickClientApi.Api` is resolved to plain shapes, so the frontend never compiles
the server. Code that already compiles with the server's source — its own
tests, for one — can use the global `KickApi` instead: same types. See
[Typed client](https://kickjs.app/guide/typed-client.html#frontends-outside-the-server-s-typescript-program).

- **Paths + params + body typed** from the generated route map; response
  types flow from your controller handlers (return-value style) via
  `InferHandlerResponse`.
- **Runtime-neutral**: fetch/URL/Headers only — browsers, node ≥ 20, Bun, Deno,
  edge workers. Zero dependencies.
- **Typed errors**: non-2xx throws `KickClientError` carrying the parsed body
  (RFC 9457 problem details when the server used `ctx.problem`).
- **Injectable fetch**: pass `{ fetch: app.fetch }` from `@forinda/kickjs/web`
  for network-free integration tests.

## Documentation

[kickjs.app/guide/typed-client](https://kickjs.app/guide/typed-client)

## License

MIT
