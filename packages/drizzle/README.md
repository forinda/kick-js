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
- `DrizzleTenantAdapter` — multi-tenant adapter with per-tenant connection caching
- `DRIZZLE_DB` token — singleton, provider/single-tenant database
- `DRIZZLE_TENANT_DB` token — transient, current tenant's database via AsyncLocalStorage
- `DrizzleQueryAdapter` — translates `ParsedQuery` from `@forinda/kickjs` into Drizzle queries
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

## Multi-Tenant

Use `DrizzleTenantAdapter` alongside `TenantAdapter` for database-per-tenant:

```typescript
import { DrizzleTenantAdapter, DRIZZLE_TENANT_DB } from '@forinda/kickjs-drizzle'
import { TenantAdapter } from '@forinda/kickjs-multi-tenant'

bootstrap({
  modules,
  adapters: [
    new TenantAdapter({ strategy: 'subdomain' }),
    new DrizzleTenantAdapter({
      providerDb: drizzle(providerPool, { schema }),
      tenantFactory: async (tenantId) => {
        const url = await lookupTenantDbUrl(tenantId)
        return drizzle(new Pool({ connectionString: url }), { schema })
      },
      onTenantShutdown: (db, tenantId) => {
        // Close the pool when shutting down
      },
    }),
  ],
})

// In a service — resolves to the current tenant's typed DB
@Service()
class ProjectService {
  @Inject(DRIZZLE_TENANT_DB) private db!: NodePgDatabase<typeof schema>

  async findAll() {
    return this.db.select().from(projects)
  }
}
```

Use both adapters together for interop:

```typescript
@Inject(DRIZZLE_DB) private providerDb!: typeof db          // always provider
@Inject(DRIZZLE_TENANT_DB) private tenantDb!: typeof db     // current tenant
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
