# @forinda/kickjs-prisma

Prisma adapter for KickJS. Registers `PrismaClient` in the DI container, manages lifecycle (connect/disconnect), and ships a typed `PrismaModelDelegate` for cast-free repositories. Supports Prisma 5, 6, and 7+ (auto-detects logging method).

## Install

```bash
kick add prisma
```

## Quick Example

```ts
import { PrismaClient } from '@prisma/client'
import { bootstrap } from '@forinda/kickjs'
import { PrismaAdapter } from '@forinda/kickjs-prisma'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [PrismaAdapter({ client: new PrismaClient(), logging: true })],
})
```

Inject in services:

```ts
import { Inject, Service } from '@forinda/kickjs'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'

@Service()
class UserService {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  findAll() {
    return this.prisma.user.findMany()
  }
}
```

For Prisma 7 driver-adapter setup (e.g. `PrismaPg`) and the multi-tenant `PrismaTenantAdapter`, see the [examples/task-prisma-api](https://github.com/forinda/kick-js/tree/main/examples/task-prisma-api) and [examples/multi-tenant-prisma-api](https://github.com/forinda/kick-js/tree/main/examples/multi-tenant-prisma-api) apps.

## Documentation

[forinda.github.io/kick-js/api/prisma](https://forinda.github.io/kick-js/api/prisma)

## License

MIT
