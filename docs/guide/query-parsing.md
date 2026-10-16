# Query Parsing

KickJS includes an ORM-agnostic query string parser that turns URL parameters into structured filter, sort, pagination, and search objects. Use it directly or through the `ctx.qs()` convenience method.

## Basic Usage

```ts
import { Controller, Get } from '@forinda/kickjs'
import { RequestContext } from '@forinda/kickjs'

@Controller()
class TaskController {
  @Get('/')
  async list(ctx: RequestContext) {
    const parsed = ctx.qs({
      filterable: ['status', 'priority'],
      sortable: ['createdAt', 'title'],
    })
    // parsed.filters, parsed.sort, parsed.pagination, parsed.search
  }
}
```

The equivalent standalone call:

```ts
import { parseQuery } from '@forinda/kickjs'

const parsed = parseQuery(req.query, { filterable: ['status'] })
```

## Query String Format

### Filters

Format: `?filter=field:operator:value` (repeatable).

```
GET /tasks?filter=status:eq:active&filter=priority:gte:3
```

Supported operators:

| Operator   | Meaning                                               |
| ---------- | ----------------------------------------------------- |
| `eq`       | Equal                                                 |
| `neq`      | Not equal                                             |
| `gt`       | Greater than                                          |
| `gte`      | Greater than or equal                                 |
| `lt`       | Less than                                             |
| `lte`      | Less than or equal                                    |
| `between`  | Between two values (value format is adapter-specific) |
| `in`       | In a set of values                                    |
| `contains` | Contains substring                                    |
| `starts`   | Starts with                                           |
| `ends`     | Ends with                                             |

Values may contain colons (useful for timestamps like `2025-01-01T00:00:00`), because only the first two colons are used as delimiters.

### Sort

Either form works, repeated or comma-separated, and the order is the order of the keys:

- `field:asc` / `field:desc`
- `-field` for descending, `field` (or `+field`) for ascending

```
GET /tasks?sort=createdAt:desc&sort=title:asc
GET /tasks?sort=-createdAt,title          # the same
```

An item with an unknown direction, or a field outside `sortable`, is dropped.

### Pagination

| Parameter | Default | Max |
| --------- | ------- | --- |
| `page`    | 1       | --  |
| `limit`   | 20      | 100 |

The parser computes `offset` automatically: `(page - 1) * limit`.

```
GET /tasks?page=2&limit=10
```

### Search

A free-text query passed as `?q=`. Truncated to 200 characters.

```
GET /tasks?q=deploy+script
```

## QueryFieldConfig

Restrict which fields clients can filter and sort on. Fields not in the allow-list are silently dropped.

### String-based (standard)

```ts
const config = {
  filterable: ['status', 'priority'],
  sortable: ['createdAt', 'title'],
  searchable: ['title', 'description'],
}
```

### Object-based (column metadata)

Adapters can also accept a richer config whose `columns`/`sortable` keys map to backend-specific column metadata instead of plain strings. `ctx.qs()` and `ctx.paginate()` extract the allowed field names from `Object.keys()` automatically, so the same object drives both the parser and your query builder:

```ts
import type { ColumnQueryFieldConfig } from '@forinda/kickjs'
import { tasks } from '@/db/schema'

export const TASK_QUERY_CONFIG: ColumnQueryFieldConfig = {
  columns: {
    status: tasks.status,
    priority: tasks.priority,
  },
  sortable: {
    title: tasks.title,
    createdAt: tasks.createdAt,
  },
  searchColumns: [tasks.title, tasks.key],
}

// Both work:
const parsed = ctx.qs(TASK_QUERY_CONFIG)
return ctx.paginate(fetcher, TASK_QUERY_CONFIG)
```

### TypeScript interface

```ts
// String-based
interface StringQueryFieldConfig {
  filterable?: string[]
  sortable?: string[]
  searchable?: string[]
}

// Column-object-based
interface ColumnQueryFieldConfig {
  columns: Record<string, any>
  sortable?: Record<string, any>
  searchColumns?: any[]
}

// Union — both accepted
type QueryFieldConfig = StringQueryFieldConfig | ColumnQueryFieldConfig
```

## ParsedQuery Result

```ts
interface ParsedQuery {
  filters: FilterItem[] // { field, operator, value }
  sort: SortItem[] // { field, direction }
  pagination: PaginationParams // { page, limit, offset }
  search: string
}
```

## Round-Trip with buildQueryParams

Convert a `ParsedQuery` back into a query parameter object, useful for generating links or in tests:

```ts
import { buildQueryParams } from '@forinda/kickjs'

const params = buildQueryParams(parsed)
// { filter: ['status:eq:active'], sort: ['createdAt:desc'], page: 2, limit: 10, q: 'deploy' }
```

## QueryBuilderAdapter Interface

To connect parsed queries to your ORM, implement the `QueryBuilderAdapter` interface:

```ts
import { QueryBuilderAdapter, ParsedQuery } from '@forinda/kickjs'

class SqlQueryAdapter implements QueryBuilderAdapter<SqlResult, SqlConfig> {
  readonly name = 'sql'

  build(parsed: ParsedQuery, config: SqlConfig): SqlResult {
    // Convert filters to WHERE conditions
    // Convert sort to ORDER BY clauses
    return { where, orderBy, limit: parsed.pagination.limit, offset: parsed.pagination.offset }
  }
}
```

The adapter pattern keeps the query parser ORM-agnostic. You can write adapters for `@forinda/kickjs-db`, raw SQL, an in-memory store, or any other query builder.

## Paginated Responses with ctx.paginate()

The `ctx.paginate()` method wraps a service call into a standardized paginated response. It combines the parsed query pagination with your data-fetching logic and returns a `PaginatedResponse`.

### PaginatedResponse Shape

```ts
interface PaginatedResponse<T> {
  data: T[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
  links: { self: string; next: string | null; prev: string | null }
}
```

### Usage

Your fetcher receives the parsed query and returns `data` (the page of results) and `total` (the count across all pages):

```ts
@Service()
class TaskService {
  async findPaginated(parsed: ParsedQuery) {
    const { pagination, filters } = parsed
    const [data, total] = await Promise.all([
      this.repo.find({ ...filters, skip: pagination.offset, take: pagination.limit }),
      this.repo.count(filters),
    ])
    return { data, total }
  }
}
```

Then in your controller, hand `ctx.paginate()` the fetcher and the field config. It sends the response and returns the payload, so `return ctx.paginate(...)` types the route:

```ts
import { Autowired, Controller, Get, type RequestContext } from '@forinda/kickjs'

@Controller()
class TaskController {
  @Autowired() private taskService!: TaskService

  @Get('/')
  list(ctx: RequestContext) {
    return ctx.paginate((parsed) => this.taskService.findPaginated(parsed), {
      filterable: ['status', 'priority'],
      sortable: ['createdAt', 'title'],
    })
  }
}
```

The response sent to the client looks like:

```json
{
  "data": [
    { "id": 1, "title": "Deploy v2", "status": "active" },
    { "id": 2, "title": "Write tests", "status": "active" }
  ],
  "meta": {
    "page": 2,
    "limit": 10,
    "total": 57,
    "totalPages": 6,
    "hasNext": true,
    "hasPrev": true
  },
  "links": {
    "self": "/api/v1/tasks?filter=status:eq:active&page=2&limit=10",
    "next": "/api/v1/tasks?filter=status:eq:active&limit=10&page=3",
    "prev": "/api/v1/tasks?filter=status:eq:active&limit=10&page=1"
  }
}
```

The `meta` fields are computed from the pagination values in the parsed query and the `total` you provide. `links` repeat the current request with `page` replaced — every other parameter is kept as sent — and `next` / `prev` are `null` at the ends. Links are path + query only, never a host: the host comes from the client, so it never goes into a link.

## Cursor pagination

Offset pages (`?page=3`) are simple and give a total, but the database still walks every skipped row, and a row inserted or deleted while someone pages shifts everything after it — they see a row twice or miss one. Cursor (keyset) pages say "the rows after this one" instead, so each page costs the same and stays stable under writes.

| Use                    | When                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ctx.paginate()`       | Admin tables, small or slow-changing data, UIs that jump to page N or show a total                                       |
| `ctx.paginateCursor()` | Feeds, timelines, infinite scroll, sync/export jobs, large tables — anything read in order where "next" is the only move |

### Request and response

`ctx.paginateCursor()` reads `?cursor=<opaque>&limit=` plus the usual `filter`, `sort` and `q`. `limit` has the same default and maximum as offset pagination; `page` is ignored. No `cursor` (or an empty one) is the first page.

```ts
interface CursorPaginatedResponse<T> {
  data: T[]
  meta: {
    limit: number
    hasNext: boolean
    nextCursor: string | null // pass back as ?cursor= — null on the last page
  }
  links: { self: string; next: string | null }
}
```

```json
{
  "data": [{ "id": "p9", "createdAt": "2026-03-02T10:00:00.000Z" }],
  "meta": { "limit": 20, "hasNext": true, "nextCursor": "eyJ2Ijp7ImNyZWF0ZWRBdCI6…" },
  "links": {
    "self": "/api/v1/posts?sort=-createdAt",
    "next": "/api/v1/posts?sort=-createdAt&cursor=eyJ2Ijp7ImNyZWF0ZWRBdCI6…"
  }
}
```

A client follows `links.next` (or sends `meta.nextCursor` as `cursor`) until it is `null`. There is no total and no previous link — that is the trade.

### The fetcher contract

```ts
@Get('/')
list(ctx: RequestContext) {
  return ctx.paginateCursor(
    (q) => this.posts.findAfter({ ...q, limit: q.limit + 1 }),
    { filterable: ['authorId'], sortable: ['createdAt'] },
  )
}
```

The fetcher receives `{ filters, sort, search, cursor, limit }` and must:

1. order rows by the sort fields, then by the id as a tie-breaker (so the order is total — equal `createdAt` values cannot swap places between pages);
2. return only rows strictly **after** `cursor` in that order (`cursor` is `null` on the first page);
3. return up to **`limit + 1`** rows. The framework trims the extra row; its presence is what sets `hasNext`.

The cursor is the last returned row's values for the active sort fields plus its id, e.g. `{ createdAt: '2026-03-02T10:00:00.000Z', id: 'p9' }` — `Date` values arrive as ISO strings. It also records the sort it was issued under: replaying it with a different `sort` answers **400**, as does a cursor that does not decode to that shape.

Options (third argument):

- `idField` — the tie-breaker field, default `'id'`.
- `cursorKey: (row) => Record<string, string | number | boolean | null>` — build the cursor values yourself when the row's property names differ from the sortable field names.

With no `sort` in the request, rows are ordered by the id alone. A row missing a sort field or the id throws, so a fetcher that selects too few columns fails loudly rather than issuing a broken cursor.

### A kick/db keyset query

Descending by `createdAt`, the "after the cursor" condition is `(created_at, id) < ($1, $2)`. kick/db's [condition helpers](./database/queries.md#condition-helpers) have no row-value form, so spell it out with `or` / `and` — it is the same predicate, and a composite index on `(created_at, id)` serves both:

```ts
import { and, eq, lt, or } from '@forinda/kickjs-db'
import type { CursorQuery } from '@forinda/kickjs'
import { posts } from '../db/schema'

async findAfter({ cursor, limit }: CursorQuery) {
  // WHERE tenant_id = $1 AND (created_at < $2 OR (created_at = $2 AND id < $3))
  // ORDER BY created_at DESC, id DESC LIMIT $4
  const after = cursor
    ? or(
        lt(posts.createdAt, new Date(cursor.createdAt as string)),
        and(
          eq(posts.createdAt, new Date(cursor.createdAt as string)),
          lt(posts.id, cursor.id as string),
        ),
      )
    : undefined
  return this.db
    .selectFrom('posts')
    .selectAll()
    .where('tenantId', '=', this.tenantId)
    .where(and(after))
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(limit) // the caller already asked for limit + 1
    .execute()
}
```

For an ascending sort, flip `lt` to `gt` and `desc` to `asc`. With several sort fields the condition expands the same way: `a > x OR (a = x AND b > y) OR (a = x AND b = y AND id > z)`.

### Cursors are not signed

A cursor is base64url JSON, readable and editable by the client. That is deliberate — it only says _where_ to resume, never _what_ the caller may see:

- The decoded values are plain JSON primitives handed to your fetcher. Bind them as query parameters (as above); never splice them into SQL.
- Keep filters and authorization scoping (tenant, owner, visibility) in the fetcher's `WHERE`, computed from the request — not from the cursor. A forged cursor can then only move the starting point within rows the caller is already allowed to read.

The generated in-memory repository (`kick g module`) ships a `findAfter` that implements this contract; the generated controller's `list` carries a comment showing the switch from `paginate` to `paginateCursor`.
