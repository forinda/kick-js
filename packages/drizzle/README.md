# @forinda/kickjs-drizzle

Drizzle ORM adapter with DI integration, transaction support, and query building for KickJS.

## Install

```bash
# Using the KickJS CLI (recommended — auto-installs peer dependencies)
kick add drizzle

# Manual install
pnpm add @forinda/kickjs-drizzle drizzle-orm
```

## Features

- `DrizzleAdapter` — lifecycle adapter that manages the Drizzle connection
- `DRIZZLE_DB` token for injecting the database instance via DI
- `DrizzleQueryAdapter` — translates `ParsedQuery` from `@forinda/kickjs-http` into Drizzle queries
- `toQueryFieldConfig` helper for field mapping

## Quick Example

```typescript
import { DrizzleAdapter, DRIZZLE_DB, DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const client = postgres(process.env.DATABASE_URL!)
const db = drizzle(client)

bootstrap({
  modules,
  adapters: [
    new DrizzleAdapter({ db }),
  ],
})

// In a service, inject the DB
@Service()
class UserService {
  @Inject(DRIZZLE_DB) private db!: typeof db

  async findAll() {
    return this.db.select().from(users)
  }
}
```

## Query Adapter

```typescript
import { DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'

const adapter = new DrizzleQueryAdapter()
const query = adapter.build(parsedQuery, {
  columns: { name: users.name, email: users.email },
  searchColumns: [users.name, users.email],
})
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/)

## License

MIT
