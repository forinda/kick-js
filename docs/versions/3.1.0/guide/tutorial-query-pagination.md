# Type-Safe Filtering, Sorting & Pagination with DrizzleQueryParamsConfig

*Part 3 of "Building a Jira Clone with KickJS + Drizzle ORM"*

---

Every list endpoint in Vibed supports filtering, sorting, search, and pagination. This article covers how we built that with Drizzle ORM's Column objects, and how the approach evolved across three framework releases.

## The Problem

A typical task list endpoint needs to handle queries like:

```
GET /api/v1/tasks?filter=status:eq:in-progress&filter=priority:eq:high&sort=createdAt:desc&q=auth&page=1&limit=20
```

That's filtering by status AND priority, sorting by creation date, searching by title/key, and paginating. Every list endpoint has different filterable/sortable/searchable fields.

## The Config Object

Each module defines a `DrizzleQueryParamsConfig` that declares which columns can be filtered, sorted, and searched:

```typescript
// src/modules/tasks/constants.ts
import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { tasks } from '@/db/schema'

export const TASK_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    projectId: tasks.projectId,
    workspaceId: tasks.workspaceId,
    status: tasks.status,
    priority: tasks.priority,
    reporterId: tasks.reporterId,
  },
  sortable: {
    title: tasks.title,
    status: tasks.status,
    priority: tasks.priority,
    dueDate: tasks.dueDate,
    createdAt: tasks.createdAt,
  },
  searchColumns: [tasks.title, tasks.key],
}
```

The keys in `columns` and `sortable` are the query parameter names. The values are actual Drizzle Column objects — not strings. This gives you:

1. **Compile-time validation** — rename a column and TypeScript catches it
2. **Automatic type coercion** — the adapter reads the column's `dataType` to coerce "true" → boolean, "42" → number
3. **Single source of truth** — the same config drives Swagger docs, query parsing, and SQL generation

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

### Repository — SQL generation

```typescript
async findPaginated(parsed: ParsedQuery, projectId?: string) {
  const query = queryAdapter.buildFromColumns(parsed, {
    ...TASK_QUERY_CONFIG,
    ...(projectId ? { baseCondition: eq(tasks.projectId, projectId) } : {}),
  })

  const [data, countResult] = await Promise.all([
    this.db.select().from(tasks)
      .where(query.where)
      .orderBy(...query.orderBy)
      .limit(query.limit)
      .offset(query.offset),
    this.db.select({ count: sql<number>`count(*)` }).from(tasks)
      .where(query.where),
  ])

  return { data, total: countResult[0]?.count ?? 0 }
}
```

`buildFromColumns()` converts the parsed query into Drizzle-compatible SQL fragments:
- `query.where` — a combined SQL condition (filters + search + baseCondition)
- `query.orderBy` — an array of `asc()`/`desc()` calls
- `query.limit` / `query.offset` — pagination values

## The baseCondition Pattern

Many endpoints need scoping — tasks belong to a project, notifications belong to a user, activities belong to a workspace. The `baseCondition` parameter prepends an additional WHERE clause:

```typescript
// Notifications — always scoped to the authenticated user
const query = queryAdapter.buildFromColumns(parsed, {
  ...NOTIFICATION_QUERY_CONFIG,
  baseCondition: eq(notifications.recipientId, userId),
})

// Activities — scoped by workspace, optionally by project and task
const conditions = [eq(activities.workspaceId, scope.workspaceId)]
if (scope.projectId) conditions.push(eq(activities.projectId, scope.projectId))
if (scope.taskId) conditions.push(eq(activities.taskId, scope.taskId))

const query = queryAdapter.buildFromColumns(parsed, {
  ...ACTIVITY_QUERY_CONFIG,
  baseCondition: and(...conditions),
})
```

This composability is why Column objects matter — `baseCondition` takes a Drizzle SQL expression, not a string. It integrates naturally with `eq()`, `and()`, and any other Drizzle operator.

## The Pagination Response

`ctx.paginate()` wraps your fetcher's `{ data, total }` into a standardized response:

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
  }
}
```

The count query runs in parallel with the data query via `Promise.all` — no wasted round trips.

## Evolution Across Framework Versions

We started on KickJS v1.2.8 and hit several issues that were resolved across releases:

### v1.2.8 — String-based configs only

```typescript
// Old: strings, no type safety
const queryAdapter = new DrizzleQueryAdapter({ eq, ne, ... })
const query = queryAdapter.build(parsed, {
  table: tasks,
  searchColumns: ['title', 'key'],  // strings — no compile-time validation
})
```

### v1.2.9 — Column-based configs introduced

```typescript
// New: Column objects with buildFromColumns()
const query = queryAdapter.buildFromColumns(parsed, TASK_QUERY_CONFIG)
```

But `@ApiQueryParams` and `ctx.paginate` still only accepted string-based configs. We had to write a bridge helper.

### v1.2.10 — Full Column support everywhere

`@ApiQueryParams` and `ctx.paginate` now accept `DrizzleQueryParamsConfig` directly. The bridge helper was deleted. One config object flows through all three layers without conversion.

## The Shared QueryAdapter

Every repository needs the same `DrizzleQueryAdapter` instance. We extracted it to avoid 15-line import duplication:

```typescript
// src/shared/infrastructure/query-adapter.ts
import { eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc } from 'drizzle-orm'
import { DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'

export const queryAdapter = new DrizzleQueryAdapter({
  eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc,
})
```

Repositories import it and only add the operators they use directly in their methods:

```typescript
import { eq, sql } from 'drizzle-orm'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'
```

## Endpoints That Don't Need Pagination

Not every list endpoint is paginated. Workspaces and projects return small sets scoped to the user:

```typescript
// Workspaces — a user typically has < 10, no pagination needed
@Get('/')
async list(ctx: RequestContext) {
  const user = getUser(ctx)
  const workspaces = await this.listWorkspacesUseCase.executeForUser(user.id)
  ctx.json(successResponse(workspaces))
}
```

Use `ctx.paginate()` when the result set can grow unbounded (tasks, comments, notifications, activities). Use direct JSON responses for inherently small collections.

## Next Up

In [Part 4](/guide/tutorial-realtime), we'll cover real-time features — SSE streams for live dashboards and WebSocket chat with rooms, typing indicators, and presence tracking.
