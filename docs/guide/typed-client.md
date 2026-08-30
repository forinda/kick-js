# Typed Client

`@forinda/kickjs-client` closes the type loop from controller to consumer: the
frontend calls your API with **full autocomplete and inferred response types**,
generated from the backend's own handlers — no duplicated interfaces, no drift.

```bash
pnpm add @forinda/kickjs-client
```

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

`KickApi` above is an **ambient global**, populated by importing the server's
generated route types. Those types infer responses by referencing controller
classes, so the frontend's `tsc` ends up compiling the server's source graph —
decorators, path aliases, ORM types and all. In a small repo that is free. At
scale it is not: one measured app needed `experimentalDecorators`,
`emitDecoratorMetadata`, a `@/*` fallback into server source and five ambient
imports before it compiled, and its typecheck went from 1.7s / 819 MB to 10.8s
/ 4.9 GB — per frontend, per CI run.

`kick typegen` also emits `.kickjs/types/kick__client.d.ts`, which removes the
reference entirely: every type resolved to a literal shape, shared shapes
hoisted, and **no imports at all**.

List it in the frontend's tsconfig `types`, the same way you would `node` or
`vitest/globals`:

```json
{
  "compilerOptions": {
    "types": ["../../api/.kickjs/types/kick__client"]
  }
}
```

The route map is then ambient — no import, no bridge file, no decorator
settings, no path aliases:

```ts
export const api = createClient<KickClientApi.Api>({ baseUrl: '/api/v1' })
```

Only the namespace is global. The resolved shapes it references stay inside the
file, so nothing else lands in your global scope.

This is what `kick new --template fullstack` scaffolds.

::: tip Off unless the project uses it
Producing this map builds a whole TypeScript program over the server — measured
at 1.1 GB and ~7.6s on a 1,940-route app, against ~130ms for every other
typegen plugin combined. An API with no frontend should not pay that for a file
nothing reads, so `kick typegen` only builds it when the project wants it:

```ts
// kick.config.ts
export default defineConfig({
  typegen: { client: true },
})
```

Off unless set. `kick new --template fullstack` writes `client: true`, so its
web app has the map from the first run; every other project opts in here.

If the file is already on disk and this is unset, `kick typegen` says so rather
than refreshing it silently — a map left to rot is how a frontend ends up
type-checking against routes the server no longer serves.

That cost is paid only when something the map depends on actually moved. Each
run fingerprints the project's source files, its lockfile, the compiler options,
the CLI version and the scanned route keys; when the fingerprint matches the one
recorded beside the last map — and the map on disk is still the file that
fingerprint produced — the program is never built and the existing file stands. On that same
1,940-route app an unchanged run is **0.85s and 230 MB** against 7.5s and
1.2 GB — and because the fingerprint hashes contents rather than timestamps, a
rebuild that rewrites identical bytes does not invalidate it. Editing a single
source file does.

The record lives in `.kickjs/cache/client-map.sha1`, inside the already-ignored
`.kickjs/` directory. Delete it to force a rebuild. `kick typegen --check`
never writes it — that flag is read-only.
:::

### Expansion depth

A response is expanded inline up to 12 levels; past that it is emitted as
`unknown` and the route is named in a warning. Truncation is loud and safe —
`unknown` has to be narrowed by the consumer, so it can never be mistaken for a
type the server does not return.

The default is rarely reached. Recursive types and named types both hoist into
their own `interface __Tn`, which costs one level instead of the whole budget,
so only deep _anonymous_ nesting spends it. On a 1,940-route app the emitted map
is byte-identical at 12, 24, 48 and 96.

Raise it if a route tells you it hit the limit:

```ts
// kick.config.ts
export default defineConfig({
  typegen: { client: { maxDepth: 24 } },
})
```

The object form is on unless you say otherwise, so `{ maxDepth: 24 }` on its own
also enables the map; `{ enabled: false }` turns it off. Changing the depth
changes what is emitted, so it invalidates the cache and rebuilds.

::: warning `types` replaces automatic `@types` inclusion
Listing anything in `types` switches off TypeScript's automatic inclusion of
every `@types/*` package. If your frontend relies on that, name what it needs
alongside the map: `"types": ["node", "../../api/.kickjs/types/kick__client"]`.
:::

### The alternatives

**`include`**, if you would rather not touch `types` at all:

```json
{ "include": ["src", "../../api/.kickjs/types/kick__client.d.ts"] }
```

The difference is what happens when the file has not been generated. A `types`
entry reports `TS2688: Cannot find type definition file`, which is the useful
failure for something your app depends on. An `include` entry tolerates it
silently, and `KickClientApi` simply fails to resolve — better for a repo where
the map is not always present.

**An explicit import**, if you would rather have no global at all. The same file
exports the type:

```ts
import type { Api } from '../../api/.kickjs/types/kick__client'

export const api = createClient<Api>({ baseUrl: '/api/v1' })
```

Every entry that resolves carries the same type as the ambient map — it is
produced by resolving that map, not by inferring a second time — so moving a
frontend across changes no call sites, whichever wiring you pick.

::: tip Why `KickClientApi` and not `KickApi`
`kick__routes.ts` already declares a global `KickApi`, and both files live in
`.kickjs/types`, which the server's own tsconfig includes. Sharing the name
makes the **server** stop compiling with `TS2300: Duplicate identifier`. The two
maps coexist under separate names, and a frontend only ever sees this one.
:::

`kick typegen --check` gates staleness in CI, exactly as with the other
generated files.

::: warning Read the warnings on a generation run
A route the resolver cannot resolve is **skipped with a warning**, not guessed
at, so a run that printed warnings produced a map that is a _subset_ of
`KickRoutes.Api` — the types in it are still exact, but a route may be missing
and a call to it will not compile. Treat a warning as an incomplete refresh:
fix what it names and re-run, and keep `kick typegen --check` in CI so an
incomplete map cannot be committed unnoticed.
:::

::: warning Not refreshed by `kick dev`
Resolving these types builds a full TypeScript program over the server, which is
a build-step cost rather than a per-save one — so `kick dev` leaves this one
file alone while everything else in `.kickjs/types/` keeps updating on save.
Re-run `kick typegen` after changing a response shape. The ambient
`KickRoutes.Api` the server itself uses is unaffected.
:::

::: tip Needs a compiler API
This uses TypeScript's compiler API, an optional peer dependency. TypeScript 7
ships no JS compiler API at all, so install the compatibility package there:
`pnpm add -D @typescript/typescript6`. Without one, `kick typegen` prints a
warning and skips just this file.
:::

## baseUrl and route keys

`KickRoutes.Api` keys are **module-mount relative** (`'GET /tasks/:id'`); the
bootstrap-level prefix and version (default `/api/v1`) go in `baseUrl`.

## RPC-style calls

Prefer `rpc.tasks.get(...)` over path strings? `kick typegen` also emits a
runtime manifest (`kickRpc`) — `createRpc` builds a typed namespace over the
same client:

```ts
import { createRpc } from '@forinda/kickjs-client'
import { kickRpc } from './server-types' // re-export of .kickjs/types/kick__routes

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
