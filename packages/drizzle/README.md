# @forinda/kickjs-drizzle

Drizzle ORM adapter for KickJS — DI integration, lifecycle management, and a `DrizzleQueryAdapter` that translates `ParsedQuery` into Drizzle `where` / `orderBy` / `limit` / `offset`.

## Install

```bash
kick add drizzle
```

## Quick Example

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { bootstrap, getEnv } from '@forinda/kickjs'
import { DrizzleAdapter } from '@forinda/kickjs-drizzle'
import * as schema from './schema'
import { modules } from './modules'

const client = postgres(getEnv('DATABASE_URL'))
const db = drizzle(client, { schema })

export const app = await bootstrap({
  modules,
  adapters: [DrizzleAdapter({ db, onShutdown: () => client.end() })],
})
```

Inject the typed db in services:

```ts
import { Inject, Service } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

@Service()
class UserService {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase<typeof schema>) {}
}
```

For the multi-tenant `DrizzleTenantAdapter` see the [examples/multi-tenant-drizzle-api](https://github.com/forinda/kick-js/tree/main/examples/multi-tenant-drizzle-api) app.

## Documentation

[forinda.github.io/kick-js/api/drizzle](https://forinda.github.io/kick-js/api/drizzle)

## License

MIT
