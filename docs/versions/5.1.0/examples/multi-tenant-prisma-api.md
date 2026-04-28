# Multi-Tenant (Prisma)

Database-per-tenant multi-tenancy with Prisma ORM. Each tenant gets a separate `PrismaClient` with its own `datasourceUrl`.

## Features

- `TenantAdapter` with subdomain resolution
- `TenantConnectionManager<PrismaClient>` — typed connection cache
- `TenantDbService` — injectable wrapper using `getCurrentTenant()`
- `AuthAdapter` with JWT authentication
- Provider/tenant pattern with fallback to default database
- Each `getDb()` call returns a fully typed `PrismaClient`

## Key Files

| File | Purpose |
|------|---------|
| `src/db/schema.ts` | Shared types, provider tenant registry |
| `src/db/tenant-manager.ts` | `TenantConnectionManager<TDb>` + Prisma factory |
| `src/db/tenant-db.service.ts` | `@Service()` wrapping tenant DB resolution |
| `src/index.ts` | Bootstrap with `TenantAdapter` + `AuthAdapter` |
| `src/modules/projects/` | Controller demonstrating tenant-scoped queries |

## Running

```bash
cd examples/multi-tenant-prisma-api
pnpm install
kick dev
```

## Source

- [examples/multi-tenant-prisma-api/](https://github.com/forinda/kick-js/tree/main/examples/multi-tenant-prisma-api)

## See Also

- [Multi-Tenancy Guide](/guide/multi-tenancy) — concepts, patterns, all ORMs
