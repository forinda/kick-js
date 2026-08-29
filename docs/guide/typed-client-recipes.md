# Typed Client Recipes (TanStack Query / SWR)

The [typed client](./typed-client.md) returns real types from every call, so
data-fetching libraries infer everything downstream — **no wrapper package
needed**. These recipes are copy-paste patterns, not new dependencies.

Everything below assumes the fullstack setup:

```ts
// src/api.ts
import { createClient } from '@forinda/kickjs-client'

export const api = createClient<KickApi>({ baseUrl: '/api/v1' })
```

## TanStack Query (React Query v5)

### Queries — types flow through `queryFn`

```tsx
import { useQuery } from '@tanstack/react-query'
import { api } from './api'

function Task({ id }: { id: string }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => api.get('/tasks/:id', { params: { id } }),
  })
  // data: Task | undefined — inferred from the server handler, no annotations

  if (isPending) return <p>loading…</p>
  if (error) return <p>{error.message}</p>
  return <h1>{data.title}</h1>
}
```

### Reusable `queryOptions` per resource

v5's `queryOptions` helper keeps key + fetcher together and stays fully typed:

```ts
import { queryOptions } from '@tanstack/react-query'
import { api } from './api'

export const taskQueries = {
  all: () =>
    queryOptions({
      queryKey: ['tasks'] as const,
      queryFn: () => api.get('/tasks'),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: ['tasks', id] as const,
      queryFn: () => api.get('/tasks/:id', { params: { id } }),
    }),
}

// usage — data is Task[] / Task respectively:
useQuery(taskQueries.all())
useQuery(taskQueries.detail(id))
```

### Mutations + invalidation

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    // variables typed from the route's body schema; result from the handler
    mutationFn: (body: { title: string }) => api.post('/tasks', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

// const { mutate } = useCreateTask()
// mutate({ title: 'Ship it' })      // ✓ typed; { titel: … } is a compile error
```

### Typed errors

Non-2xx responses throw `KickClientError` — narrow it in error UI or in a
global handler:

```ts
import { QueryClient } from '@tanstack/react-query'
import { KickClientError } from '@forinda/kickjs-client'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        // never retry 4xx — the server said no, asking again won't help
        error instanceof KickClientError && error.status < 500 ? false : count < 3,
    },
  },
})
```

`error.body` carries the parsed [RFC 9457 problem details](./error-handling.md)
when the server responded via `ctx.problem` / thrown `HttpException`s.

### Query strings

Routes with a typed query shape constrain the options object — pass them
through and put them in the key:

```ts
queryOptions({
  queryKey: ['tasks', { sort: '-createdAt' }] as const,
  queryFn: () => api.get('/tasks', { query: { sort: '-createdAt' } }), // sort union autocompletes
})
```

## SWR

Same idea — the fetcher IS the typed call, so `data` infers:

```tsx
import useSWR from 'swr'
import { api } from './api'

function Task({ id }: { id: string }) {
  const { data, error, isLoading } = useSWR(['tasks', id], () =>
    api.get('/tasks/:id', { params: { id } }),
  )
  // data: Task | undefined

  if (isLoading) return <p>loading…</p>
  if (error) return <p>failed</p>
  return <h1>{data!.title}</h1>
}
```

Mutation via `useSWRMutation`:

```tsx
import useSWRMutation from 'swr/mutation'
import { api } from './api'

const createTask = (_key: string, { arg }: { arg: { title: string } }) =>
  api.post('/tasks', { body: arg })

function NewTask() {
  const { trigger, isMutating } = useSWRMutation('tasks', createTask)
  return (
    <button disabled={isMutating} onClick={() => trigger({ title: 'Ship it' })}>
      Create
    </button>
  )
}
```

## axios instead of native fetch

The client never calls global `fetch` directly — it goes through the optional
`fetch` option, which takes a web-standard `Request` and returns a `Response`.
Anything matching that shape works, so axios needs an adapter, not a wrapper
package:

```ts
// src/api.ts
import axios from 'axios'
import { createClient } from '@forinda/kickjs-client'

export const api = createClient<KickApi>({
  baseUrl: '/api/v1',
  fetch: async (request) => {
    const res = await axios({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      data: request.body ? await request.text() : undefined,
      signal: request.signal,
      responseType: 'arraybuffer',
      validateStatus: () => true, // KickClientError owns non-2xx, not axios
    })

    const headers = new Headers()
    for (const [key, value] of Object.entries(res.headers.toJSON())) {
      for (const one of Array.isArray(value) ? value : [value]) {
        headers.append(key, String(one))
      }
    }
    const empty = res.status === 204 || res.status === 205 || res.status === 304
    return new Response(empty ? null : res.data, { status: res.status, headers })
  },
})
```

Everything downstream is unchanged — the recipes above, `KickClientError`, and
the inferred return types all work the same way.

### Three things that will bite you

- **`validateStatus: () => true` is mandatory.** axios rejects on 4xx/5xx by
  default, so the axios error escapes before the client can build a
  [`KickClientError`](./typed-client.md#errors). Every `catch` block that reads
  `err.status` / `err.body` breaks. Let axios resolve every status and leave the
  throwing to the client.
- **Null-body statuses throw in the `Response` constructor.** `204`, `205` and
  `304` must be constructed with `null`, hence the `empty` guard. Without it a
  `noContent()` handler fails in the adapter rather than resolving to
  `undefined`.
- **SSE hangs — it does not fail.**
  [`api.stream()`](./typed-client.md#typed-sse-streams) consumes
  `response.body` incrementally, but `responseType: 'arraybuffer'` makes axios
  buffer: it resolves only once the response _ends_, and an SSE response never
  ends. So `await axios(...)` never returns. The stream is not the problem —
  the `Response` this adapter builds does carry a `body` — the buffering is.
  Axios can stream (`responseType: 'stream'` on Node's `http` adapter, or the
  `fetch` adapter, which is not the browser default — that's `xhr`), but each
  route needs a second code path in the adapter, and the `fetch` adapter puts
  you back on fetch anyway. **If the app calls `api.stream()`, keep native
  fetch for it.**

### Do you actually need axios?

Two of the usual reasons are already covered without the dependency:

- **Auth interceptors** — `headers` accepts an async factory that runs per
  request, so token refresh needs no interceptor:
  ```ts
  createClient<KickApi>({
    baseUrl: '/api/v1',
    headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
  })
  ```
- **Retries, logging, tracing** — the `fetch` option is the interceptor. Wrap
  native fetch and you keep streaming:
  ```ts
  fetch: async (request) => {
    // Replay only what is safe to repeat. A 5xx does NOT prove the server
    // ignored the request — retrying a POST can double-charge a customer.
    const replayable = request.method === 'GET' || request.method === 'HEAD'
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(request.clone())
      if (!replayable || res.status < 500 || attempt === 2) return res
    }
  }
  ```
  Retrying writes needs more than a method check: the endpoint has to be
  idempotent on the server, usually via a client-sent idempotency key it
  dedupes on. Don't widen the condition without that guarantee.

axios earns its place when you need something native fetch genuinely lacks —
upload/download progress events, or a shared instance the rest of a legacy app
already configures.

## Conventions that pay off

- **One `api.ts`, one place for auth** — the `headers` factory runs per request,
  so token refresh needs no per-hook plumbing.
- **Keys mirror paths** — `['tasks', id]` for `/tasks/:id` keeps invalidation
  guessable.
- **Let inference work** — don't annotate `useQuery<Task>`; if you have to,
  the type loop is broken somewhere upstream (re-run `kick typegen`).
- **Tests**: [`createTestClient`](./typed-client.md#network-free-testing) +
  a `QueryClientProvider` wrapper gives fully-typed hook tests with zero
  network.
- **Separate repo or a frontend that typechecks slowly?** Import
  `.kickjs/types/kick__client.d.ts` instead of the ambient bridge — same types,
  no server source in your `tsc` run. See
  [frontends outside the server's TypeScript program](./typed-client.md#frontends-outside-the-server-s-typescript-program).
