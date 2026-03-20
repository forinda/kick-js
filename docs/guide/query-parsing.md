# Query Parsing

KickJS includes an ORM-agnostic query string parser that turns URL parameters into structured filter, sort, pagination, and search objects. Use it directly or through the `ctx.qs()` convenience method.

## Basic Usage

```ts
import { Controller, Get } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'

@Controller('/tasks')
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
import { parseQuery } from '@forinda/kickjs-http'

const parsed = parseQuery(req.query, { filterable: ['status'] })
```

## Query String Format

### Filters

Format: `?filter=field:operator:value` (repeatable).

```
GET /tasks?filter=status:eq:active&filter=priority:gte:3
```

Supported operators:

| Operator | Meaning |
| --- | --- |
| `eq` | Equal |
| `neq` | Not equal |
| `gt` | Greater than |
| `gte` | Greater than or equal |
| `lt` | Less than |
| `lte` | Less than or equal |
| `between` | Between two values (value format is adapter-specific) |
| `in` | In a set of values |
| `contains` | Contains substring |
| `starts` | Starts with |
| `ends` | Ends with |

Values may contain colons (useful for timestamps like `2025-01-01T00:00:00`), because only the first two colons are used as delimiters.

### Sort

Format: `?sort=field:asc` or `?sort=field:desc` (repeatable).

```
GET /tasks?sort=createdAt:desc&sort=title:asc
```

### Pagination

| Parameter | Default | Max |
| --- | --- | --- |
| `page` | 1 | -- |
| `limit` | 20 | 100 |

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

```ts
interface QueryFieldConfig {
  filterable?: string[]
  sortable?: string[]
  searchable?: string[]
}
```

## ParsedQuery Result

```ts
interface ParsedQuery {
  filters: FilterItem[]   // { field, operator, value }
  sort: SortItem[]        // { field, direction }
  pagination: PaginationParams // { page, limit, offset }
  search: string
}
```

## Round-Trip with buildQueryParams

Convert a `ParsedQuery` back into a query parameter object, useful for generating links or in tests:

```ts
import { buildQueryParams } from '@forinda/kickjs-http'

const params = buildQueryParams(parsed)
// { filter: ['status:eq:active'], sort: ['createdAt:desc'], page: 2, limit: 10, q: 'deploy' }
```

## QueryBuilderAdapter Interface

To connect parsed queries to your ORM, implement the `QueryBuilderAdapter` interface:

```ts
import { QueryBuilderAdapter, ParsedQuery } from '@forinda/kickjs-http'

class DrizzleQueryAdapter implements QueryBuilderAdapter<DrizzleResult, DrizzleConfig> {
  readonly name = 'drizzle'

  build(parsed: ParsedQuery, config: DrizzleConfig): DrizzleResult {
    // Convert filters to Drizzle SQL conditions
    // Convert sort to Drizzle orderBy clauses
    return { where, orderBy, limit: parsed.pagination.limit, offset: parsed.pagination.offset }
  }
}
```

The adapter pattern keeps the query parser ORM-agnostic. You can write adapters for Drizzle, Prisma, Sequelize, or any other query builder.

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
}
```

### Usage

Your service method should return an object with `data` (the page of results) and `total` (the total count across all pages):

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

Then in your controller, call `ctx.paginate()` with the parsed query and the service result:

```ts
import { Controller, Get } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'

@Controller('/tasks')
class TaskController {
  @Autowired() private taskService!: TaskService

  @Get('/')
  async list(ctx: RequestContext) {
    const parsed = ctx.qs({
      filterable: ['status', 'priority'],
      sortable: ['createdAt', 'title'],
    })
    const { data, total } = await this.taskService.findPaginated(parsed)
    return ctx.paginate({ data, total, parsed })
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
  }
}
```

The `meta` fields are computed automatically from the pagination values in the parsed query and the `total` you provide. This ensures a consistent pagination contract across all your endpoints.
