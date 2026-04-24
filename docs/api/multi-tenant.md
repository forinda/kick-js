# @forinda/kickjs-multi-tenant

Multi-tenancy support for KickJS applications with multiple tenant resolution strategies.

::: danger Deprecated — dropped in v5
This package is deprecated and will be removed in v5. New projects should use the BYO recipe in [Multi-tenancy with KickJS](../guide/multi-tenancy.md), which resolves the tenant in a `defineHttpContextDecorator()` (typed via `ContextMeta`) and reads it anywhere via `getRequestValue('tenant')`. The API below documents v4.2.0 behaviour for adopters mid-migration.
:::

## Installation

```bash
pnpm add @forinda/kickjs-multi-tenant
```

## Exports

### Adapter

| Export | Description |
|--------|-------------|
| `TenantAdapter` | AppAdapter that resolves the current tenant on each request |

### DI Token

| Export | Description |
|--------|-------------|
| `TENANT_CONTEXT` | Injection token for accessing the resolved tenant in services and controllers |

### Types

| Export | Description |
|--------|-------------|
| `TenantAdapterOptions` | Configuration options for `TenantAdapter` |
| `TenantInfo` | The resolved tenant object available via DI |
| `TenantStrategy` | Union type of built-in strategy names |

## TenantAdapter Options

```ts
interface TenantAdapterOptions {
  /** Tenant resolution strategy */
  strategy: 'header' | 'subdomain' | 'path' | 'query' | TenantResolverFn
  /** Header name when using 'header' strategy (default: 'x-tenant-id') */
  header?: string
  /** Query parameter name when using 'query' strategy (default: 'tenant') */
  queryParam?: string
  /** Called when no tenant can be resolved — throw or return a fallback */
  onTenantNotFound?: (req: Request) => string | never
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `strategy` | `string \| Function` | — | How to resolve the tenant identifier from each request |
| `header` | `string` | `'x-tenant-id'` | Header name for the `header` strategy |
| `queryParam` | `string` | `'tenant'` | Query parameter name for the `query` strategy |
| `onTenantNotFound` | `(req) => string` | throws 400 | Fallback when tenant cannot be resolved |

## Strategies

### `header`

Reads the tenant ID from a request header.

```ts
TenantAdapter({ strategy: 'header', header: 'x-tenant-id' })
// Request: GET /users  -H "x-tenant-id: acme"
// Tenant ID: "acme"
```

### `subdomain`

Extracts the tenant ID from the first subdomain.

```ts
TenantAdapter({ strategy: 'subdomain' })
// Request: GET https://acme.example.com/users
// Tenant ID: "acme"
```

### `path`

Extracts the tenant ID from the first URL path segment.

```ts
TenantAdapter({ strategy: 'path' })
// Request: GET /acme/users
// Tenant ID: "acme"
```

### `query`

Reads the tenant ID from a query parameter.

```ts
TenantAdapter({ strategy: 'query', queryParam: 'tenant' })
// Request: GET /users?tenant=acme
// Tenant ID: "acme"
```

### Custom resolver

Provide a function for full control over tenant resolution.

```ts
TenantAdapter({
  strategy: (req: Request) => {
    // Resolve from JWT, database lookup, etc.
    const token = req.headers.authorization?.split(' ')[1]
    return extractTenantFromToken(token)
  },
})
```

## TENANT_CONTEXT

The resolved tenant is available via DI using the `TENANT_CONTEXT` injection token. It uses `AsyncLocalStorage` internally so each request gets the correct tenant — even under concurrent requests.

```ts
interface TenantInfo {
  id: string
  name?: string
  metadata?: Record<string, any>
}
```

### getCurrentTenant()

For code that can't use DI (utilities, middleware), use the functional helper:

```ts
import { getCurrentTenant } from '@forinda/kickjs-multi-tenant'

function logForTenant(message: string) {
  const tenant = getCurrentTenant()
  console.log(`[${tenant?.id ?? 'no-tenant'}] ${message}`)
}
```

Returns `undefined` outside request scope.

## Per-Tenant Database Switching

Configure database isolation per tenant via the `database` option:

```ts
TenantAdapter({
  strategy: 'header',
  database: {
    mode: 'database',
    resolve: async (tenantId) => ({
      host: 'db.example.com',
      database: `tenant_${tenantId}`,
      user: 'app',
      password: process.env.DB_PASSWORD!,
    }),
    cache: { ttl: 300_000 },
  },
})
```

Three isolation modes:

| Mode | Description |
|------|-------------|
| `database` | Each tenant gets a separate database |
| `schema` | Shared database, separate PostgreSQL schemas |
| `discriminator` | Shared tables with a `tenant_id` column |

The `TENANT_DB` DI token resolves to the current tenant's connection.

## Example

### Bootstrap

```ts
import { bootstrap } from '@forinda/kickjs'
import { TenantAdapter } from '@forinda/kickjs-multi-tenant'

bootstrap({
  modules,
  adapters: [
    TenantAdapter({
      strategy: 'header',
      header: 'x-tenant-id',
      onTenantNotFound: () => {
        throw new Error('Tenant header is required')
      },
    }),
  ],
})
```

### Using in a Controller

```ts
import { Controller, Get } from '@forinda/kickjs'
import { Inject } from '@forinda/kickjs'
import { TENANT_CONTEXT, TenantInfo } from '@forinda/kickjs-multi-tenant'
import type { RequestContext } from '@forinda/kickjs'

@Controller()
export class UserController {
  @Inject(TENANT_CONTEXT)
  private tenant!: TenantInfo

  @Get('/')
  async list(ctx: RequestContext) {
    // Use tenant ID to scope database queries
    const users = await db.users.findMany({
      where: { tenantId: this.tenant.id },
    })
    return ctx.json(users)
  }
}
```

### Using in a Service

```ts
import { Service } from '@forinda/kickjs'
import { Inject } from '@forinda/kickjs'
import { TENANT_CONTEXT, TenantInfo } from '@forinda/kickjs-multi-tenant'

@Service()
export class UserService {
  @Inject(TENANT_CONTEXT)
  private tenant!: TenantInfo

  async findAll() {
    return db.users.findMany({
      where: { tenantId: this.tenant.id },
    })
  }
}
```

## Related

- [Adapters Guide](../guide/adapters.md) -- how adapters hook into the KickJS lifecycle
- [@forinda/kickjs-core](./core.md) -- DI container, injection tokens
- [Dependency Injection](../guide/dependency-injection.md) -- `@Inject` token usage
