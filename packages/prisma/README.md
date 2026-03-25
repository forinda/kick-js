# @forinda/kickjs-prisma

Prisma ORM adapter for the [KickJS](https://forinda.github.io/kick-js/) framework. Provides DI integration, lifecycle management, and type-safe query building.

## Features

- **PrismaAdapter** — registers `PrismaClient` in the DI container, handles graceful disconnect on shutdown
- **PrismaQueryAdapter** — translates `ParsedQuery` into Prisma-compatible `findMany` arguments (`where`, `orderBy`, `skip`, `take`)
- **Type-safe searchColumns** — generic `PrismaQueryConfig<TModel>` validates field names at compile time
- **PRISMA_CLIENT** token for DI injection
- Optional query logging

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
import { PrismaClient } from './generated/prisma'
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
```

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

## Documentation

[Full documentation](https://forinda.github.io/kick-js/)

## License

MIT
