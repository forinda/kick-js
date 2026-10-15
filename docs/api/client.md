# @forinda/kickjs-client

Typed fetch client for KickJS APIs. It reads the `KickRoutes.Api` map that `kick typegen` generates, so paths, params, bodies, query strings and response types are checked at the call site. Zero dependencies and no server imports: it runs in browsers, Node 20+, Bun, Deno and edge workers.

The [Typed client guide](../guide/typed-client.md) covers setup with typegen and frontends in another project; [Typed client recipes](../guide/typed-client-recipes.md) has patterns for auth, React Query and more.

## Install

```bash
pnpm add @forinda/kickjs-client
```

## Entry points

| Import path              | Exports                                                                                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@forinda/kickjs-client` | `createClient`, `createTestClient`, `createRpc`, `KickClientError`, and the types `KickClient`, `ClientOptions`, `RequestOptions`, `ClientMethod`, `RouteShapeLike`, `SseEvent`, `SseStream`, `FetchLike`, `RpcManifest`, `KickRpc` |

## createClient

Create a client over a `KickRoutes.Api`-shaped map. The map is a type argument only — there is no runtime dependency on the generated file.

```typescript
function createClient<Api extends object>(options: ClientOptions): KickClient<Api>
```

```ts
import { createClient } from '@forinda/kickjs-client'

const api = createClient<KickRoutes.Api>({
  baseUrl: 'https://example.com/api/v1',
  headers: () => ({ authorization: `Bearer ${getToken()}` }),
})

const task = await api.get('/tasks/:id', { params: { id: '42' } })
const created = await api.post('/tasks', { body: { title: 'Ship' } })
```

### ClientOptions

| Field     | Type                                                                                          | Default        | Description                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl` | `string`                                                                                      | — (required)   | Base URL including the API prefix and version (`/api/v1` by default). Route keys are relative to it. A trailing `/` is dropped. |
| `headers` | `Record<string, string> \| (() => Record<string, string> \| Promise<Record<string, string>>)` | —              | Headers sent with every request. The function form runs per request (auth tokens).                                              |
| `fetch`   | `(request: Request) => Promise<Response>`                                                     | global `fetch` | Custom fetch — a platform fetch, a mock, or an in-process app's `fetch`.                                                        |

## KickClient

```typescript
interface KickClient<Api extends object> {
  get<P extends PathsFor<Api, 'GET'> & string>(
    path: P,
    ...args: ArgsFor<ShapeOf<Api, 'GET', P>, 'GET'>
  ): Promise<ShapeOf<Api, 'GET', P>['response']>
  // post, put, delete, patch: same shape for their verb
  stream<P extends StreamPathsFor<Api> & string>(
    path: P,
    ...args: ArgsFor<ShapeOf<Api, 'GET', P>, 'GET'>
  ): Promise<SseStream<SsePayloadOf<ShapeOf<Api, 'GET', P>['response']>>>
}

type ClientMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
```

Each verb accepts only the paths registered under that verb and returns that route's `response` type. `options` is required when the route has path params or a required body, and optional otherwise.

### RequestOptions

| Field     | Type                     | Description                                                                                                                                |
| --------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `params`  | route's params shape     | Fills `:param` segments (URL-encoded). Required when the route has params; a missing one throws.                                           |
| `body`    | route's body shape       | Sent as JSON with `content-type: application/json` unless you set one. Not allowed on `get`.                                               |
| `query`   | route's query shape      | Serialised to the query string; arrays repeat the key, `null` / `undefined` are skipped. Loose `Record` when the route has no typed query. |
| `headers` | `Record<string, string>` | Merged over the client-level headers.                                                                                                      |
| `signal`  | `AbortSignal`            | Cancels the request.                                                                                                                       |

Responses: a 204 resolves to `undefined`, a JSON content type is parsed, anything else is returned as text. A non-2xx status throws [`KickClientError`](#kickclienterror).

### stream

Opens a typed server-sent-events connection to a GET route whose handler returns `ctx.sse<T>()`. Only such routes are accepted.

```typescript
interface SseStream<T = unknown> extends AsyncIterable<SseEvent<T>> {
  close(): void // aborts the request and ends iteration
}

interface SseEvent<T = unknown> {
  data: T // JSON-parsed; the raw string when not valid JSON
  event?: string
  id?: string
}
```

```ts
const events = await api.stream('/events')
for await (const ev of events) {
  console.log(ev.data)
  if (done) events.close()
}
```

## KickClientError

Thrown for non-2xx responses (and by `stream` on a non-2xx response or a missing body). A rejected `fetch` (network failure, abort) propagates its original error.

```typescript
class KickClientError extends Error {
  readonly status: number
  readonly body: unknown // parsed response body
  readonly response: Response
}
```

The message is the body's `detail` (RFC 9457 problem details), else its `error`, else `Request failed with status <status>`.

```ts
try {
  await api.get('/tasks/:id', { params: { id: 'missing' } })
} catch (err) {
  if (err instanceof KickClientError && err.status === 404) showNotFound()
}
```

## createTestClient

A client over an in-process app, for network-free tests.

```typescript
function createTestClient<Api extends object>(
  app: FetchLike,
  options?: Omit<ClientOptions, 'fetch' | 'baseUrl'> & { baseUrl?: string },
): KickClient<Api>

interface FetchLike {
  fetch(request: Request): Promise<Response>
}
```

`baseUrl` defaults to `http://test/api/v1`; set it when the server uses another prefix or version.

```ts
const app = createWebApp({ h3, modules })
const api = createTestClient<KickRoutes.Api>(app)
expect(await api.get('/tasks/:id', { params: { id: '1' } })).toEqual({ id: '1', title: 'Ship' })
```

## createRpc

tRPC-style calls over a client, using the `kickRpc` manifest that `kick typegen` emits (`controller.method → 'VERB /path'`). Each call delegates to the matching verb, so headers, errors and query handling are the same.

```typescript
function createRpc<Api extends object, const M extends RpcManifest>(
  api: KickClient<Api>,
  manifest: M,
): KickRpc<Api, M>

type RpcManifest = Record<string, Record<string, string>>
```

```ts
import { kickRpc } from './.kickjs/types/kick__routes'

const rpc = createRpc(api, kickRpc)
const task = await rpc.tasks.get({ params: { id: '42' } })
```

SSE routes are typed `never` on the RPC surface — open them with `api.stream(path)`.

## RouteShapeLike

The per-route shape the client expects in each map value. Declared here so frontends never install the server package.

```typescript
interface RouteShapeLike {
  params: unknown
  body: unknown
  query: unknown
  response: unknown
}
```

## See also

- [Typed client guide](../guide/typed-client.md)
- [Typed client recipes](../guide/typed-client-recipes.md)
- [Typegen](../guide/typegen.md)
