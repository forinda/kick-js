# Typed Client

`@forinda/kickjs-client` closes the type loop from controller to consumer: the
frontend calls your API with **full autocomplete and inferred response types**,
generated from the backend's own handlers — no duplicated interfaces, no drift.

<PmCommand add="@forinda/kickjs-client" />

`kick typegen` emits a global `KickApi` alias for `KickRoutes.Api` — use
whichever reads better; they're identical.

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

const api = createClient<KickApi>({
  baseUrl: 'https://api.example.com/api/v1',
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
})

const task = await api.get('/tasks/:id', { params: { id: '42' } }) // task: Task
const made = await api.post('/tasks', { body: { title: 'Ship' } }) // made: Task
```

Wrong path, missing `params.id`, wrong body shape — all **compile errors**.

## Frontends outside the server's TypeScript program

`KickApi` points at your controller classes, so a frontend using it compiles
the server's source too — decorators, path aliases, ORM types. For a separate
frontend app, turn on the standalone client map instead. It has no imports, so
the frontend never sees server code:

```ts
// kick.config.ts
export default defineConfig({
  typegen: { client: true },
})
```

`kick new --template fullstack` sets this for you. Then list the map in the
frontend's tsconfig `types`:

```json
{
  "compilerOptions": {
    "types": ["../../api/.kickjs/types/kick__client"]
  }
}
```

and use the global `KickClientApi.Api`:

```ts
export const api = createClient<KickClientApi.Api>({ baseUrl: '/api/v1' })
```

Listing anything in `types` turns off automatic `@types/*` inclusion, so add
what the frontend needs (`"types": ["node", "../../api/.kickjs/types/kick__client"]`).
If you'd rather not use a global, import it: `import type { Api } from '../../api/.kickjs/types/kick__client'`.

### The map describes JSON, not the server's objects

The types are the shape the client _receives_, which is not always the shape the
handler returned. `JSON.stringify` is applied on the way out, so the map applies
the same rules:

| in the handler         | in the map                           | why                                           |
| ---------------------- | ------------------------------------ | --------------------------------------------- |
| `Date`                 | `string`                             | `Date.prototype.toJSON` returns an ISO string |
| `Buffer`               | `{ type: 'Buffer'; data: number[] }` | its `toJSON`                                  |
| a method               | omitted                              | functions do not serialize                    |
| `[Symbol.toStringTag]` | omitted                              | symbol keys do not serialize                  |

Any type declaring `toJSON()` is emitted as that method's return type. Without
this the map type-checks and then lies — `response.createdAt.getFullYear()`
compiles against a value that is a string at runtime.

This assumes the default transport: JSON over `fetch`, parsed with `JSON.parse`.
If your client revives values (`superjson`, a `JSON.parse` reviver that rebuilds
dates), the runtime types will be richer than the map claims.

### Keeping the map fresh

- **`kick dev` doesn't refresh it** — building it is slow on big apps. Run `kick typegen` after changing a response shape, and keep `kick typegen --check` in CI.
- **Read the warnings.** A route it can't resolve is skipped with a warning, so calls to it won't compile until you fix what the warning names.
- **Needs TypeScript's compiler API.** On TypeScript 7, `pnpm add -D @typescript/typescript6`; without it the map is skipped with a warning.
- **Very deep or recursive response types** may come out as `unknown` (with a warning). Declare a response schema on that route, or raise the nesting limit: `typegen: { client: { maxDepth: 24 } }`.

## baseUrl and route keys

`KickRoutes.Api` keys are **module-mount relative** (`'GET /tasks/:id'`); the
bootstrap-level prefix and version (default `/api/v1`) go in `baseUrl`.

## RPC-style calls

Prefer `rpc.tasks.get(...)` over path strings? `kick typegen` also emits a
runtime manifest (`kickRpc`) — `createRpc` builds a typed namespace over the
same client:

```ts
import { createRpc } from '@forinda/kickjs-client'
import { kickRpc } from './server-types' // re-exported from the server's generated types

const rpc = createRpc(api, kickRpc)

const task = await rpc.tasks.get({ params: { id: '42' } }) // task: Task
const made = await rpc.tasks.create({ body: { title: 'Ship' } })
```

Same types, same runtime behavior (headers, errors, query serialization) —
every call delegates to the path-keyed client. Namespaces come from
controller names (`TasksController` → `tasks`), methods from handler names.
SSE routes are typed `never` on the RPC surface — open those with
`api.stream(path)`.

## Typed SSE streams

Handlers that `return ctx.sse<T>()` mark the route as a typed event stream —
`api.stream()` consumes it as an async iterable:

```ts
// server
@Get('/events')
async events(ctx: RequestContext) {
  const sse = ctx.sse<{ n: number }>()
  const timer = setInterval(() => sse.send({ n: Date.now() }), 1000)
  sse.onClose(() => clearInterval(timer))
  return sse // ← carries the event type into KickApi
}

// client
const stream = await api.stream('/events') // only SSE routes accepted here
for await (const ev of stream) {
  ev.data // { n: number } — typed
}
stream.close()
```

Events arrive as `SseEvent<T>` (`data` JSON-parsed, plus optional `event` /
`id`). Non-SSE paths are rejected at compile time.

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

## Typed query strings

Routes with a statically-known query shape — a Zod `query` schema or an
`@ApiQueryParams` config — constrain `query` at the call site:

```ts
await api.get('/tasks', { query: { sort: '-createdAt' } }) // sort autocompletes
await api.get('/tasks', { query: { sort: 'created' } }) // ✗ compile error
```

Routes without one accept a loose `Record<string, string | number | boolean | array>`.

The `@ApiQueryParams` shape includes `cursor`, for routes that answer with
`ctx.paginateCursor()`. Page through them by sending `meta.nextCursor` back as
`query.cursor` rather than fetching `links.next` — the links carry the full
path (`/api/v1/...`), while the client's keys are mount-relative:

```ts
let cursor: string | undefined
do {
  const page = await api.get('/posts', { query: { sort: '-createdAt', cursor } })
  render(page.data) // CursorPaginatedResponse<Post> — typed
  cursor = page.meta.nextCursor ?? undefined
} while (cursor)
```

## Network-free testing

`createTestClient` wraps any web-standard app (a
[`createWebApp`](./edge-deployment.md) result) for in-process, fully-typed
integration tests — no server, no ports:

```ts
import { createTestClient } from '@forinda/kickjs-client'

const app = createWebApp({ h3, modules })
const api = createTestClient<KickRoutes.Api>(app)

expect(await api.get('/tasks/:id', { params: { id: '1' } })).toEqual(task)
```

`baseUrl` defaults to `http://test/api/v1`; pass
`{ baseUrl: 'http://test/custom/v2' }` for non-default prefixes.

## Notes

- Query values pass through `URLSearchParams` (arrays append repeated keys).
- `204` responses resolve to `undefined`.
- Imperative `ctx.json` handlers infer `response: unknown` — switch them to
  return-value style (or a `Reply`) for exact types, or declare the contract
  with `@Get('/', { response: schema })` (which also feeds
  [Swagger](./swagger.md#declared-response-schemas)).

- The `fetch` option is the transport seam — pass any
  `(request: Request) => Promise<Response>` to swap in a platform fetch, add
  retries/logging, or drive the client with axios. See
  [axios instead of native fetch](./typed-client-recipes.md#axios-instead-of-native-fetch).

Using TanStack Query or SWR? See the
[recipes](./typed-client-recipes.md) — the client's inference flows straight
through `queryFn`/fetchers, no wrapper needed.
