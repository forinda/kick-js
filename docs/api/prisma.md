# @forinda/kickjs-prisma

Prisma ORM adapter with DI integration, type-safe query building, and `PrismaModelDelegate` for cast-free repositories. Supports Prisma 5, 6, and 7+.

## Installation

```bash
# Using the KickJS CLI (recommended)
kick add prisma

# Manual install
pnpm add @forinda/kickjs-prisma @prisma/client
```

## Quick Start (Prisma 5/6)

```ts
import { PrismaClient } from '@prisma/client'
import { PrismaAdapter } from '@forinda/kickjs-prisma'

bootstrap({
  modules,
  adapters: [
    new PrismaAdapter({ client: new PrismaClient(), logging: true }),
  ],
})
```

## Quick Start (Prisma 7+)

```ts
import { PrismaClient } from './generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { PrismaAdapter } from '@forinda/kickjs-prisma'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const client = new PrismaClient({ adapter: new PrismaPg(pool) })

bootstrap({
  modules,
  adapters: [
    new PrismaAdapter({ client, logging: true }),
  ],
})
```

Configure `modules.prismaClientPath` in `kick.config.ts` so `kick g module --repo prisma` generates the correct import:

```ts
export default defineConfig({
  modules: {
    repo: 'prisma',
    prismaClientPath: '@/generated/prisma/client', // Prisma 7+
  },
})
```

## PrismaAdapter

Implements `AppAdapter` to manage the Prisma lifecycle:

- **`beforeStart(app, container)`** — registers the `PrismaClient` in the DI container under the `PRISMA_CLIENT` symbol. Sets up query logging if enabled.
- **`shutdown()`** — calls `prisma.$disconnect()`

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `client` | `any` | **required** | PrismaClient instance (any Prisma version) |
| `logging` | `boolean` | `false` | Log queries — uses `$on('query')` for Prisma 5/6, `$extends` for Prisma 7+ |

## PrismaModelDelegate

A typed interface for common Prisma model CRUD operations. Use it to type-narrow the injected `PrismaClient` to a specific model without `as any` casts.

This is what `kick g module --repo prisma` generates by default:

```ts
import { Repository, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT, type PrismaModelDelegate } from '@forinda/kickjs-prisma'

@Repository()
class PrismaUserRepository {
  @Inject(PRISMA_CLIENT) private prisma!: { user: PrismaModelDelegate }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } })
  }

  async findAll() {
    return this.prisma.user.findMany()
  }

  async create(data: CreateUserDTO) {
    return this.prisma.user.create({ data: data as Record<string, unknown> })
  }
}
```

For full Prisma field-level type safety, replace `PrismaModelDelegate` with your actual PrismaClient:

```ts
import type { PrismaClient } from '@prisma/client' // or '@/generated/prisma/client' for v7
@Inject(PRISMA_CLIENT) private prisma!: PrismaClient
```

### PrismaModelDelegate Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `findUnique` | `({ where, include? }) => Promise<unknown>` | Find by unique field |
| `findFirst` | `(args?) => Promise<unknown>` | Find first match |
| `findMany` | `(args?) => Promise<unknown[]>` | Find multiple records |
| `create` | `({ data }) => Promise<unknown>` | Create a record |
| `update` | `({ where, data }) => Promise<unknown>` | Update a record |
| `delete` | `({ where }) => Promise<unknown>` | Delete a record |
| `deleteMany` | `({ where? }) => Promise<{ count }>` | Delete multiple records |
| `count` | `({ where? }) => Promise<number>` | Count records |

## PrismaQueryAdapter

Translates `ParsedQuery` from `ctx.qs()` into Prisma-compatible `findMany` arguments.

```ts
import type { User } from '@prisma/client'
import { PrismaQueryAdapter, type PrismaQueryConfig } from '@forinda/kickjs-prisma'

const queryAdapter = new PrismaQueryAdapter()

// Type-safe — only User field names accepted in searchColumns
const config: PrismaQueryConfig<User> = {
  searchColumns: ['name', 'email'],
}

const args = queryAdapter.build(parsed, config)
const users = await prisma.user.findMany(args)
```

Without the generic, `searchColumns` accepts any string:

```ts
const config: PrismaQueryConfig = {
  searchColumns: ['name', 'email'],
}
```

### Filter Operator Mapping

| Operator | Prisma Clause | Example Query |
|----------|---------------|---------------|
| `eq` | `{ equals: value }` | `?filter[status]=eq:active` |
| `neq` | `{ not: value }` | `?filter[status]=neq:banned` |
| `gt` | `{ gt: value }` | `?filter[age]=gt:18` |
| `gte` | `{ gte: value }` | `?filter[age]=gte:21` |
| `lt` | `{ lt: value }` | `?filter[price]=lt:100` |
| `lte` | `{ lte: value }` | `?filter[price]=lte:50` |
| `contains` | `{ contains: value, mode: 'insensitive' }` | `?filter[name]=contains:john` |
| `starts` | `{ startsWith: value }` | `?filter[name]=starts:J` |
| `ends` | `{ endsWith: value }` | `?filter[email]=ends:@gmail.com` |
| `in` | `{ in: [...values] }` | `?filter[role]=in:admin,editor` |
| `between` | `{ gte: min, lte: max }` | `?filter[age]=between:18,65` |

### PrismaQueryResult Shape

```ts
interface PrismaQueryResult {
  where?: Record<string, any>
  orderBy?: Record<string, 'asc' | 'desc'>[]
  skip?: number
  take?: number
}
```

## Exports

```ts
import {
  PrismaAdapter,
  PrismaQueryAdapter,
  PRISMA_CLIENT,
  type PrismaAdapterOptions,
  type PrismaModelDelegate,
  type PrismaQueryConfig,
  type PrismaQueryResult,
} from '@forinda/kickjs-prisma'
```
