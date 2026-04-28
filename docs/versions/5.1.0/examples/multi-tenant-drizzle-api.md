# Multi-Tenant (Drizzle)

Database-per-tenant multi-tenancy with Drizzle ORM and type-safe `TenantConnectionManager<TDb>`.

## Features

- `TenantAdapter` with subdomain resolution (`*.app.example.com`)
- `TenantConnectionManager<TDb>` — generic, typed connection cache
- `TenantDbService` — injectable wrapper using `getCurrentTenant()`
- `AuthAdapter` with JWT authentication
- Provider/tenant pattern with fallback to default database
- Each `getDb()` call returns a fully typed Drizzle instance

## Key Files

| File | Purpose |
|------|---------|
| `src/db/schema.ts` | Shared schema, provider tenant registry |
| `src/db/tenant-manager.ts` | `TenantConnectionManager<TDb>` + connection factory |
| `src/db/tenant-db.service.ts` | `@Service()` wrapping tenant DB resolution |
| `src/index.ts` | Bootstrap with `TenantAdapter` + `AuthAdapter` |
| `src/modules/projects/` | Controller demonstrating tenant-scoped queries |

## Running

```bash
cd examples/multi-tenant-drizzle-api
pnpm install
kick dev
```

```bash
# Provider (default tenant)
curl http://localhost:3000/api/v1/projects

# Specific tenant (via header since subdomain needs DNS)
curl -H "x-tenant-id: acme" http://localhost:3000/api/v1/projects
```

## Source

- [examples/multi-tenant-drizzle-api/](https://github.com/forinda/kick-js/tree/main/examples/multi-tenant-drizzle-api)

## See Also

- [Multi-Tenancy Guide](/guide/multi-tenancy) — concepts, patterns, all ORMs
