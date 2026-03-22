# @forinda/kickjs-prisma

Prisma ORM adapter with DI integration and query building for KickJS.

## Installation

```bash
pnpm add @forinda/kickjs-prisma @prisma/client
npx prisma init
```

## Quick Start

```ts
import { PrismaClient } from '@prisma/client'
import { PrismaAdapter } from '@forinda/kickjs-prisma'

const prisma = new PrismaClient()

bootstrap({
  modules,
  adapters: [
    new PrismaAdapter({ client: prisma, logging: true }),
  ],
})
```

## PrismaAdapter

Implements `AppAdapter` to manage the Prisma lifecycle:

- **`beforeStart(app, container)`** — registers the `PrismaClient` in the DI container under the `PRISMA_CLIENT` symbol
- **`shutdown()`** — calls `prisma.$disconnect()`

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `client` | `PrismaClient` | **required** | Your PrismaClient instance |
| `logging` | `boolean` | `false` | Log queries via `$on('query')` |

### Injecting PrismaClient

Use the `PRISMA_CLIENT` symbol to inject the client into services:

```ts
import { Service, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'

@Service()
class UserRepository {
  @Inject(PRISMA_CLIENT) private prisma!: PrismaClient

  async findAll() {
    return this.prisma.user.findMany()
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } })
  }

  async create(data: { name: string; email: string }) {
    return this.prisma.user.create({ data })
  }
}
```

## PrismaQueryAdapter

Translates `ParsedQuery` from `ctx.qs()` into Prisma-compatible `findMany` arguments.

```ts
import { PrismaQueryAdapter } from '@forinda/kickjs-prisma'

const queryAdapter = new PrismaQueryAdapter()

@Controller('/users')
class UserController {
  @Inject(PRISMA_CLIENT) private prisma!: PrismaClient

  @Get('/')
  async list(ctx: RequestContext) {
    const parsed = ctx.qs({
      filterable: ['status', 'role'],
      sortable: ['createdAt', 'name'],
      searchable: ['name', 'email'],
    })

    const args = queryAdapter.build(parsed, {
      searchColumns: ['name', 'email'],
    })

    const users = await this.prisma.user.findMany(args)
    ctx.json(users)
  }
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
  where?: Record<string, any>    // Prisma where clause
  orderBy?: Record<string, 'asc' | 'desc'>[]
  skip?: number                  // Offset
  take?: number                  // Limit
}
```

## Exports

```ts
import {
  PrismaAdapter,
  PrismaQueryAdapter,
  PRISMA_CLIENT,
  type PrismaAdapterOptions,
  type PrismaQueryConfig,
  type PrismaQueryResult,
} from '@forinda/kickjs-prisma'
```
