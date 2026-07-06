# Typed Client

`@forinda/kickjs-client` closes the type loop from controller to consumer: the
frontend calls your API with **full autocomplete and inferred response types**,
generated from the backend's own handlers — no duplicated interfaces, no drift.

```bash
pnpm add @forinda/kickjs-client
```

## The loop

**1. Backend** — write [return-value handlers](./controllers.md#return-value-handlers):

```ts
@Controller()
class TasksController {
  @Get('/:id')
  async get(ctx: RequestContext): Promise<Task> {
    return this.tasks.find(ctx.params.id)
  }

  @Post('/', { body: createTaskSchema })
  async create(ctx: RequestContext) {
    return reply(201, await this.tasks.create(ctx.body))
  }
}
```

**2. `kick typegen`** (runs automatically under `kick dev`) emits the
`KickRoutes.Api` map — verb+path keys with `params`/`body`/`query` from your
Zod schemas and `response` inferred from each handler's return type.

**3. Frontend** — one client, typed end to end:

```ts
import { createClient } from '@forinda/kickjs-client'

const api = createClient<KickRoutes.Api>({
  baseUrl: 'https://api.example.com/api/v1',
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
})

const task = await api.get('/tasks/:id', { params: { id: '42' } }) // task: Task
const made = await api.post('/tasks', { body: { title: 'Ship' } }) // made: Task
```

Wrong path, missing `params.id`, wrong body shape — all **compile errors**.

## baseUrl and route keys

`KickRoutes.Api` keys are **module-mount relative** (`'GET /tasks/:id'`); the
bootstrap-level prefix and version (default `/api/v1`) go in `baseUrl`.

## Errors

Non-2xx responses throw `KickClientError` with `status`, the parsed `body`
(RFC 9457 problem details when the server used `ctx.problem`), and the raw
`Response`:

```ts
try {
  await api.get('/tasks/:id', { params: { id: 'nope' } })
} catch (e) {
  if (e instanceof KickClientError && e.status === 404) showNotFound()
}
```

## Network-free testing

The client accepts a custom `fetch` — pass a
[`createWebApp`](./edge-deployment.md) handler and integration-test the full
stack in-process:

```ts
const app = createWebApp({ h3, modules })
const api = createClient<KickRoutes.Api>({
  baseUrl: 'http://test/api/v1',
  fetch: (req) => app.fetch(req),
})
```

## Notes

- Query values pass through `URLSearchParams` (arrays append repeated keys).
- `204` responses resolve to `undefined`.
- Imperative `ctx.json` handlers infer `response: unknown` — switch them to
  return-value style (or a `Reply`) for exact types.
