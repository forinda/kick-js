# @forinda/kickjs-prisma

Prisma ORM adapter for the [KickJS](https://forinda.github.io/kick-js/) framework. Provides DI integration, lifecycle management, type-safe query building, and a `PrismaModelDelegate` interface for cast-free repositories.

## Features

- **PrismaAdapter** — registers `PrismaClient` in the DI container, handles graceful disconnect on shutdown
- **PrismaQueryAdapter** — translates `ParsedQuery` into Prisma-compatible `findMany` arguments (`where`, `orderBy`, `skip`, `take`)
- **PrismaQueryConfig\<TModel\>** — generic type validates `searchColumns` against model field names at compile time
- **PrismaModelDelegate** — typed interface for Prisma model operations, eliminates `as any` in repositories
- **PRISMA_CLIENT** token for DI injection
- Supports Prisma 5, 6, and 7+ (auto-detects logging method)

## Install

```bash
# Using the KickJS CLI (recommended — auto-installs peer dependencies)
kick add prisma

# Manual install
pnpm add @forinda/kickjs-prisma @prisma/client
```

## Quick Example (Prisma 5/6)

```ts
import { PrismaClient } from '@prisma/client'
import { PrismaAdapter, PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import { Inject, Service } from '@forinda/kickjs-core'

bootstrap({
  modules,
  adapters: [
    new PrismaAdapter({ client: new PrismaClient(), logging: true }),
  ],
})

@Service()
class UserService {
  @Inject(PRISMA_CLIENT) private prisma!: PrismaClient

  async findAll() {
    return this.prisma.user.findMany()
  }
}
```

## Quick Example (Prisma 7+)

Prisma 7 uses driver adapters and generates the client to a custom output path:

```ts
import { PrismaClient } from './generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { PrismaAdapter, PRISMA_CLIENT } from '@forinda/kickjs-prisma'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const client = new PrismaClient({ adapter: new PrismaPg(pool) })

bootstrap({
  modules,
  adapters: [
    new PrismaAdapter({ client, logging: true }),
  ],
})
```

> Logging uses `$on('query', ...)` for Prisma 5/6 and `$extends` for Prisma 7+ automatically.

## PrismaModelDelegate

A typed interface for common Prisma model CRUD operations. Use it to type-narrow the injected `PrismaClient` to a specific model without `as any` casts.

```ts
import { Repository, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT, type PrismaModelDelegate } from '@forinda/kickjs-prisma'

@Repository()
export class PrismaUserRepository {
  // Type-safe: only exposes CRUD operations for the 'user' model
  @Inject(PRISMA_CLIENT) private prisma!: { user: PrismaModelDelegate }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } })
  }

  async findAll() {
    return this.prisma.user.findMany()
  }

  async create(dto: CreateUserDTO) {
    return this.prisma.user.create({ data: dto as Record<string, unknown> })
  }
}
```

This is what `kick g module --repo prisma` generates by default. For full Prisma field-level type safety, replace `PrismaModelDelegate` with your actual PrismaClient type:

```ts
// Full type safety (optional upgrade)
import type { PrismaClient } from '@prisma/client' // or '@/generated/prisma/client' for v7
@Inject(PRISMA_CLIENT) private prisma!: PrismaClient
```

### PrismaModelDelegate API

| Method | Signature | Description |
|--------|-----------|-------------|
| `findUnique` | `(args: { where, include? }) => Promise<unknown>` | Find a single record by unique field |
| `findFirst` | `(args?) => Promise<unknown>` | Find the first matching record |
| `findMany` | `(args?) => Promise<unknown[]>` | Find multiple records |
| `create` | `(args: { data }) => Promise<unknown>` | Create a new record |
| `update` | `(args: { where, data }) => Promise<unknown>` | Update an existing record |
| `delete` | `(args: { where }) => Promise<unknown>` | Delete a single record |
| `deleteMany` | `(args?: { where? }) => Promise<{ count }>` | Delete multiple records |
| `count` | `(args?: { where? }) => Promise<number>` | Count matching records |

## Query Adapter

Translate parsed query strings into Prisma `findMany` arguments:

```ts
import type { User } from '@prisma/client'
import { PrismaQueryAdapter, type PrismaQueryConfig } from '@forinda/kickjs-prisma'

const adapter = new PrismaQueryAdapter()

// Type-safe — only User field names accepted in searchColumns
const config: PrismaQueryConfig<User> = {
  searchColumns: ['name', 'email'],
}

const args = adapter.build(parsed, config)
const users = await prisma.user.findMany(args)
// args = { where: { OR: [...] }, orderBy: [...], skip: 0, take: 20 }
```

Without the generic, `searchColumns` accepts any string (backward compatible):

```ts
const config: PrismaQueryConfig = {
  searchColumns: ['name', 'email'],
}
```

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `PrismaAdapter` | class | Lifecycle adapter for DI registration and shutdown |
| `PrismaQueryAdapter` | class | Translates `ParsedQuery` to Prisma `findMany` args |
| `PRISMA_CLIENT` | symbol | DI token for injecting PrismaClient |
| `PrismaModelDelegate` | interface | Typed CRUD operations for a single Prisma model |
| `PrismaAdapterOptions` | type | Options for `PrismaAdapter` constructor |
| `PrismaQueryConfig<T>` | type | Config for `PrismaQueryAdapter.build()` with generic field validation |
| `PrismaQueryResult` | type | Result shape from `PrismaQueryAdapter.build()` |

## Documentation

[Full documentation](https://forinda.github.io/kick-js/)

## License

MIT
