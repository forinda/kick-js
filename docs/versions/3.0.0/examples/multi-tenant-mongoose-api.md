# Multi-Tenant (Mongoose)

Database-per-tenant multi-tenancy with MongoDB and Mongoose. Each tenant gets its own database on the cluster with connection-scoped models.

## Features

- `TenantAdapter` with subdomain resolution
- `TenantConnectionManager<Connection>` — typed connection cache
- `TenantDbService` — injectable wrapper using `getCurrentTenant()`
- `AuthAdapter` with JWT authentication
- Provider/tenant pattern with fallback to default database
- Models scoped per connection (`conn.model('User', schema)`)

## Key Files

| File | Purpose |
|------|---------|
| `src/db/schema.ts` | Shared types, provider tenant registry |
| `src/db/tenant-manager.ts` | `TenantConnectionManager<TDb>` + Mongoose factory |
| `src/db/tenant-db.service.ts` | `@Service()` wrapping tenant DB resolution |
| `src/index.ts` | Bootstrap with `TenantAdapter` + `AuthAdapter` |
| `src/modules/projects/` | Controller demonstrating tenant-scoped queries |

## Running

```bash
cd examples/multi-tenant-mongoose-api
pnpm install
kick dev
```

## Source

- [examples/multi-tenant-mongoose-api/](https://github.com/forinda/kick-js/tree/main/examples/multi-tenant-mongoose-api)

## See Also

- [Multi-Tenancy Guide](/guide/multi-tenancy) — concepts, patterns, all ORMs
