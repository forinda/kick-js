# Multi-Tenancy

KickJS supports multi-tenant architectures where a single application serves multiple tenants (organizations, teams, customers) with isolated data. The `@forinda/kickjs-multi-tenant` package handles tenant resolution, and you wire it to your ORM of choice for database isolation.

## Installation

```bash
kick add multi-tenant
```

## Core Concepts

| Term | Meaning |
|------|---------|
| **Provider** | The default/root tenant that owns the tenant registry (e.g., your SaaS platform) |
| **Tenant** | A customer organization resolved from the request |
| **Tenant DB** | A database (or schema) scoped to a single tenant |
| **Provider DB** | The default database that stores all tenant records |

## Tenant Resolution

Three built-in strategies determine which tenant a request belongs to:

### Subdomain

```ts
TenantAdapter({ strategy: 'subdomain' })
// acme.app.example.com → tenant: 'acme'
// app.example.com       → tenant: null (falls back to provider)
```

### Header

```ts
TenantAdapter({ strategy: 'header', headerName: 'x-tenant-id' })
// X-Tenant-Id: acme → tenant: 'acme'
```

### Custom Function

```ts
TenantAdapter({
  strategy: async (req) => {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) return null
    const payload = jwt.decode(token)
    return payload?.tenantId ? { id: payload.tenantId } : null
  },
})
```

All examples below assume one of these strategies is configured. The resolution method doesn't affect the database wiring.

## Database-per-Tenant Pattern

The most common pattern: each tenant has its own database, and a provider database stores the tenant registry.

### Architecture

```
Request → Resolve Tenant (subdomain/header/jwt)
        → Look up tenant in Provider DB
        → Get or create tenant DB connection
        → Controller uses tenant-scoped DB
```

### Type-Safe Connection Manager

The connection manager maintains a cache of typed database instances keyed by tenant ID, defaulting to the provider when no tenant is resolved. The implementation is ORM-specific — see the [example apps](#examples) for complete Drizzle, Prisma, and MongoDB implementations.

The core pattern:

```ts
// Generic — works with any ORM
class TenantConnectionManager<TDb> {
  private connections = new Map<string, TDb>()

  constructor(
    private factory: (tenantId: string) => TDb | Promise<TDb>,
    private defaultTenantId = 'provider',
  ) {}

  async getDb(tenantId?: string): Promise<TDb> {
    const key = tenantId ?? this.defaultTenantId
    if (!this.connections.has(key)) {
      this.connections.set(key, await this.factory(key))
    }
    return this.connections.get(key)!
  }
}
```

### Controller Usage

Regardless of ORM, the controller pattern is the same:

```ts
@Controller('/projects')
@Authenticated()
export class ProjectController {
  @Autowired() private tenantDb!: TenantDbService

  @Get('/')
  async list(ctx: RequestContext) {
    const db = await this.tenantDb.current()
    // db is fully typed for your ORM
    return ctx.json(await db.select().from(projects))
  }
}
```

### Examples

Complete working implementations in the `examples/` directory:

| Example | ORM | DB Type |
|---------|-----|---------|
| `multi-tenant-drizzle-api` | Drizzle | `NodePgDatabase<typeof schema>` per tenant |
| `multi-tenant-prisma-api` | Prisma | `PrismaClient` per tenant with `datasourceUrl` switching |
| `multi-tenant-mongoose-api` | Mongoose | `mongoose.Connection` per tenant with model-per-connection |

Each example includes `TenantConnectionManager<TDb>`, `TenantDbService`, bootstrap wiring with `TenantAdapter` + `AuthAdapter`, and a `ProjectController` demonstrating tenant-scoped queries.

## Security Considerations

- Always resolve the tenant **before** authentication — `TenantAdapter` runs at `beforeGlobal`, `AuthAdapter` at `beforeRoutes`
- Use `roleResolver` on `AuthAdapter` for tenant-scoped roles (see [Authorization](/guide/authorization))
- Never trust tenant IDs from the client without validating against the provider DB
- Set connection pool limits per tenant to prevent a single tenant from exhausting resources
- Use `secretResolver` on `JwtStrategy` for per-tenant JWT signing keys in high-isolation environments

## See Also

- [Authentication](/guide/authentication) — strategies, CSRF, events
- [Authorization](/guide/authorization) — tenant-scoped RBAC, @Policy/@Can
- [API Reference](/api/multi-tenant) — TenantAdapter options, TENANT_CONTEXT, database types
