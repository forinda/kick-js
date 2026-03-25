# @forinda/kickjs-prisma

Prisma ORM adapter for the [KickJS](https://forinda.github.io/kick-js/) framework. Provides DI integration, lifecycle management, and query building.

## Features

- **PrismaAdapter** - Registers a `PrismaClient` in the DI container and handles graceful disconnect on shutdown.
- **PrismaQueryAdapter** - Translates framework-agnostic `ParsedQuery` objects into Prisma-compatible `findMany` arguments (`where`, `orderBy`, `skip`, `take`).
- Optional query logging.

## Installation

```bash
# Using the KickJS CLI (recommended — auto-installs peer dependencies)
kick add prisma

# Manual install
pnpm add @forinda/kickjs-prisma @prisma/client
```

## Usage

```ts
import { PrismaClient } from '@prisma/client'
import { PrismaAdapter, PRISMA_CLIENT } from '@forinda/kickjs-prisma'

// Register the adapter
bootstrap({
  modules,
  adapters: [
    new PrismaAdapter({ client: new PrismaClient(), logging: true }),
  ],
})

// Inject in services
@Service()
class UserService {
  @Inject(PRISMA_CLIENT) private prisma: PrismaClient
}
```

## License

MIT
