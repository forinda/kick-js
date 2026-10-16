# Type-Safe Filtering, Sorting & Pagination

_Part 3 of "Building a Task Management App with KickJS"_

---

Every list endpoint in Vibed supports filtering, sorting, search, and pagination. This article covers how we built that with the framework's ORM-agnostic query parser, and how the approach evolved across releases.

## The Problem

A typical task list endpoint needs to handle queries like:

```
GET /api/v1/tasks?filter=status:eq:in-progress&filter=priority:eq:high&sort=createdAt:desc&q=auth&page=1&limit=20
```

That's filtering by status AND priority, sorting by creation date, searching by title/key, and paginating. Every list endpoint has different filterable/sortable/searchable fields.

## The Config Object

Each module defines a query config that declares which fields can be filtered, sorted, and searched:

```typescript
// src/modules/tasks/constants.ts
import type { QueryFieldConfig } from '@forinda/kickjs'

export const TASK_QUERY_CONFIG: QueryFieldConfig = {
  filterable: ['projectId', 'workspaceId', 'status', 'priority', 'reporterId'],
  sortable: ['title', 'status', 'priority', 'dueDate', 'createdAt'],
  searchable: ['title', 'key'],
}
```

The entries in `filterable` and `sortable` are the query parameter names clients are allowed to use. Keeping them in one exported constant gives you:

1. **A single allow-list** — fields not declared here are silently dropped, so clients can't filter or sort on arbitrary columns
2. **Single source of truth** — the same config drives Swagger docs, query parsing, and your query builder
3. **Easy refactors** — change the allowed fields in one place

::: tip Column-object configs
If your data layer exposes column metadata (for example a SQL query builder), you can pass an object-based `ColumnQueryFieldConfig` instead — `ctx.qs()` and `ctx.paginate()` read the allowed field names from `Object.keys()`. See [Query Parsing](./query-parsing.md#object-based-column-metadata).
:::

## Using the Config

The config flows through three layers:

### Controller — Swagger docs + query parsing

```typescript
@Get('/')
@ApiQueryParams(TASK_QUERY_CONFIG)
async list(ctx: RequestContext) {
  return ctx.paginate(
    (parsed) => this.listTasksUseCase.execute(parsed, ctx.query.projectId as string | undefined),
    TASK_QUERY_CONFIG,
  )
}
```

`@ApiQueryParams(TASK_QUERY_CONFIG)` generates OpenAPI documentation listing the available filter/sort/search fields. `ctx.paginate()` parses the query string and calls your fetcher with a `ParsedQuery` object.

### Use Case — pass-through

```typescript
async execute(parsed: ParsedQuery, projectId?: string) {
  return this.repo.findPaginated(parsed, projectId)
}
```

Use cases don't know about query parsing — they just forward the `ParsedQuery`.

### Repository — turning the parsed query into results

```typescript
async findPaginated(parsed: ParsedQuery, projectId?: string) {
  const query = queryAdapter.build(parsed, {
    ...TASK_QUERY_CONFIG,
    ...(projectId ? { baseCondition: { field: 'projectId', value: projectId } } : {}),
  })

  const [data, total] = await Promise.all([
    this.store.find({
      where: query.where,
      orderBy: query.orderBy,
      limit: query.limit,
      offset: query.offset,
    }),
    this.store.count({ where: query.where }),
  ])

  return { data, total }
}
```

`queryAdapter` is the app's own [`QueryBuilderAdapter`](./query-parsing.md#querybuilderadapter-interface) implementation (see [below](#the-shared-queryadapter)). Its `build()` converts the parsed query into whatever shape your store understands:

- `query.where` — a combined condition (filters + search + baseCondition)
- `query.orderBy` — the resolved sort directives
- `query.limit` / `query.offset` — pagination values

## The baseCondition Pattern

Many endpoints need scoping — tasks belong to a project, notifications belong to a user, activities belong to a workspace. The `baseCondition` parameter prepends an additional constraint that the client can't override:

```typescript
// Notifications — always scoped to the authenticated user
const query = queryAdapter.build(parsed, {
  ...NOTIFICATION_QUERY_CONFIG,
  baseCondition: { field: 'recipientId', value: userId },
})

// Activities — scoped by workspace, optionally by project and task
const conditions = [{ field: 'workspaceId', value: scope.workspaceId }]
if (scope.projectId) conditions.push({ field: 'projectId', value: scope.projectId })
if (scope.taskId) conditions.push({ field: 'taskId', value: scope.taskId })

const query = queryAdapter.build(parsed, {
  ...ACTIVITY_QUERY_CONFIG,
  baseCondition: { and: conditions },
})
```

This composability is why keeping the adapter at the repository layer matters — `baseCondition` is expressed in your store's own terms, so it integrates naturally with whatever query builder or in-memory filter you use.

## The Pagination Response

`ctx.paginate()` wraps your fetcher's `{ data, total }` into a standardized response, sends it, and returns it:

```json
{
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  },
  "links": {
    "self": "/api/v1/tasks?page=1&limit=20",
    "next": "/api/v1/tasks?limit=20&page=2",
    "prev": null
  }
}
```

`links` repeat the current request with only `page` replaced, and are `null` at the ends. The count query runs in parallel with the data query via `Promise.all` — no wasted round trips.

For feeds and infinite scroll, `ctx.paginateCursor()` serves keyset pages (`?cursor=&limit=`) with the same config — see [Cursor pagination](./query-parsing.md#cursor-pagination).

## Evolution Across Framework Versions

We started on KickJS v1.2.8 and hit several issues that were resolved across releases:

### v1.2.8 — String-based configs only

```typescript
// Old: handed strings to the adapter, no shared config
const query = queryAdapter.build(parsed, {
  searchColumns: ['title', 'key'],
})
```

### v1.2.9 — Shared config objects introduced

```typescript
// New: one exported config drives parsing and query building
const query = queryAdapter.build(parsed, TASK_QUERY_CONFIG)
```

But `@ApiQueryParams` and `ctx.paginate` still only accepted ad-hoc configs. We had to write a bridge helper.

### v1.2.10 — Full config support everywhere

`@ApiQueryParams` and `ctx.paginate` now accept the same `QueryFieldConfig` directly. The bridge helper was deleted. One config object flows through all three layers without conversion.

## The Shared QueryAdapter

KickJS ships the parser and the `QueryBuilderAdapter` interface, not a store-specific adapter, so the app implements one and every repository shares it:

```typescript
// src/db/query-adapter.ts
import type { ParsedQuery, QueryBuilderAdapter } from '@forinda/kickjs'
import type { StoreQuery, StoreQueryConfig } from './store' // your store's types

export const queryAdapter: QueryBuilderAdapter<StoreQuery, StoreQueryConfig> = {
  name: 'store',
  build(parsed: ParsedQuery, config: StoreQueryConfig): StoreQuery {
    // filters + search + config.baseCondition → where, sort → orderBy,
    // pagination → limit / offset
  },
}
```

Repositories import the shared adapter and only add the store-specific helpers they use directly in their methods:

```typescript
import { queryAdapter } from '@/db/query-adapter'
```

## Endpoints That Don't Need Pagination

Not every list endpoint is paginated. Workspaces and projects return small sets scoped to the user:

```typescript
// Workspaces — a user typically has < 10, no pagination needed
@Get('/')
async list(ctx: RequestContext) {
  const user = getUser(ctx)
  return this.listWorkspacesUseCase.executeForUser(user.id)
}
```

Use `ctx.paginate()` when the result set can grow unbounded (tasks, comments, notifications, activities). Return the array directly for inherently small collections.

## Next Up

In [Part 4](./tutorial-realtime.md), we'll cover real-time features — SSE streams for live dashboards and WebSocket chat with rooms, typing indicators, and presence tracking.
