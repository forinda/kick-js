# @forinda/kickjs-drizzle

Drizzle ORM adapter for KickJS with DI integration and query building. Works with any Drizzle driver (PostgreSQL, MySQL, SQLite, LibSQL).

## Installation

```bash
pnpm add @forinda/kickjs-drizzle drizzle-orm
# Plus your driver:
pnpm add postgres        # PostgreSQL (postgres.js)
pnpm add better-sqlite3  # SQLite
pnpm add @libsql/client  # Turso/LibSQL
pnpm add mysql2          # MySQL
```

## Exports

| Export | Description |
|--------|-------------|
| `DrizzleAdapter` | AppAdapter that registers the Drizzle db in DI and manages lifecycle |
| `DrizzleQueryAdapter` | Translates ParsedQuery into Drizzle-compatible where/orderBy/limit/offset |
| `DRIZZLE_DB` | Symbol token for DI injection |

## Types

| Type | Description |
|------|-------------|
| `DrizzleAdapterOptions` | Constructor options for `DrizzleAdapter` |
| `DrizzleQueryConfig` | Config for `DrizzleQueryAdapter.build()` (table, searchColumns) |
| `DrizzleQueryResult` | Output shape with `where`, `orderBy`, `limit`, `offset` |
| `DrizzleOps` | Interface for drizzle-orm operator functions passed to the query adapter |

## DrizzleAdapter

### Options

```ts
interface DrizzleAdapterOptions {
  /** Drizzle db instance (return value of drizzle()) */
  db: any
  /** Enable query logging (default: false) */
  logging?: boolean
  /** Cleanup function to close the connection pool on shutdown */
  onShutdown?: () => void | Promise<void>
}
```

### Usage

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { DrizzleAdapter, DRIZZLE_DB } from '@forinda/kickjs-drizzle'

const client = postgres(process.env.DATABASE_URL!)
const db = drizzle(client)

bootstrap({
  modules,
  adapters: [
    new DrizzleAdapter({
      db,
      logging: true,
      onShutdown: () => client.end(),
    }),
  ],
})
```

### Inject in services

```ts
import { Service, Inject } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

@Service()
class UserService {
  @Inject(DRIZZLE_DB) private db!: PostgresJsDatabase
}
```

## DrizzleQueryAdapter

Translates KickJS `ParsedQuery` objects into Drizzle query builder arguments.

### Constructor

Pass the drizzle-orm operator functions:

```ts
import { eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc } from 'drizzle-orm'
import { DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'

const queryAdapter = new DrizzleQueryAdapter({
  eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc,
})
```

### Usage

```ts
import { users } from './schema'

@Get('/')
async list(ctx: RequestContext) {
  const parsed = ctx.qs({ filters: ['name', 'email', 'role'], sort: ['name', 'createdAt'] })
  const query = queryAdapter.build(parsed, {
    table: users,
    searchColumns: ['name', 'email'],
  })

  const results = await db
    .select()
    .from(users)
    .where(query.where)
    .orderBy(...query.orderBy)
    .limit(query.limit)
    .offset(query.offset)

  return ctx.json(results)
}
```

### Filter operator mapping

| KickJS Operator | Drizzle Function | Example Query |
|-----------------|-----------------|---------------|
| `eq` | `eq()` | `?filter=role:eq:admin` |
| `neq` | `ne()` | `?filter=status:neq:deleted` |
| `gt` | `gt()` | `?filter=age:gt:18` |
| `gte` | `gte()` | `?filter=price:gte:100` |
| `lt` | `lt()` | `?filter=stock:lt:10` |
| `lte` | `lte()` | `?filter=rating:lte:3` |
| `contains` | `ilike('%val%')` | `?filter=name:contains:john` |
| `starts` | `ilike('val%')` | `?filter=email:starts:admin` |
| `ends` | `ilike('%val')` | `?filter=domain:ends:.com` |
| `in` | `inArray()` | `?filter=status:in:active,pending` |
| `between` | `gte() AND lte()` | `?filter=price:between:10,50` |

## Related

- [Prisma Adapter](./prisma.md) — alternative ORM adapter
- [@forinda/kickjs-http Query Parsing](./http.md) — the ParsedQuery system
- [@forinda/kickjs-core](./core.md) — DI container, decorators
