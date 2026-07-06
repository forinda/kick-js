# Typed Client Recipes (TanStack Query / SWR)

The [typed client](./typed-client.md) returns real types from every call, so
data-fetching libraries infer everything downstream — **no wrapper package
needed**. These recipes are copy-paste patterns, not new dependencies.

Everything below assumes the fullstack setup:

```ts
// src/api.ts
import { createClient } from '@forinda/kickjs-client'

export const api = createClient<KickRoutes.Api>({ baseUrl: '/api/v1' })
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
