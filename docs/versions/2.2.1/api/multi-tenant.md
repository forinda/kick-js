# @forinda/kickjs-multi-tenant

Multi-tenancy support for KickJS applications with multiple tenant resolution strategies.

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
| `TenantContext` | The resolved tenant object available via DI |
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
new TenantAdapter({ strategy: 'header', header: 'x-tenant-id' })
// Request: GET /users  -H "x-tenant-id: acme"
// Tenant ID: "acme"
```

### `subdomain`

Extracts the tenant ID from the first subdomain.

```ts
new TenantAdapter({ strategy: 'subdomain' })
// Request: GET https://acme.example.com/users
// Tenant ID: "acme"
```

### `path`

Extracts the tenant ID from the first URL path segment.

```ts
new TenantAdapter({ strategy: 'path' })
// Request: GET /acme/users
// Tenant ID: "acme"
```

### `query`

Reads the tenant ID from a query parameter.

```ts
new TenantAdapter({ strategy: 'query', queryParam: 'tenant' })
// Request: GET /users?tenant=acme
// Tenant ID: "acme"
```

### Custom resolver

Provide a function for full control over tenant resolution.

```ts
new TenantAdapter({
  strategy: (req: Request) => {
    // Resolve from JWT, database lookup, etc.
    const token = req.headers.authorization?.split(' ')[1]
    return extractTenantFromToken(token)
  },
})
```

## TENANT_CONTEXT

The resolved tenant context is available via DI using the `TENANT_CONTEXT` injection token. It is request-scoped and contains the tenant identifier resolved by the configured strategy.

```ts
interface TenantContext {
  /** The resolved tenant identifier */
  tenantId: string
}
```

## Example

### Bootstrap

```ts
import { bootstrap } from '@forinda/kickjs'
import { TenantAdapter } from '@forinda/kickjs-multi-tenant'

bootstrap({
  modules,
  adapters: [
    new TenantAdapter({
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
import { TENANT_CONTEXT, TenantContext } from '@forinda/kickjs-multi-tenant'
import type { RequestContext } from '@forinda/kickjs'

@Controller('/users')
export class UserController {
  @Inject(TENANT_CONTEXT)
  private tenant!: TenantContext

  @Get('/')
  async list(ctx: RequestContext) {
    // Use tenant ID to scope database queries
    const users = await db.users.findMany({
      where: { tenantId: this.tenant.tenantId },
    })
    return ctx.json(users)
  }
}
```

### Using in a Service

```ts
import { Service } from '@forinda/kickjs'
import { Inject } from '@forinda/kickjs'
import { TENANT_CONTEXT, TenantContext } from '@forinda/kickjs-multi-tenant'

@Service()
export class UserService {
  @Inject(TENANT_CONTEXT)
  private tenant!: TenantContext

  async findAll() {
    return db.users.findMany({
      where: { tenantId: this.tenant.tenantId },
    })
  }
}
```

## Related

- [Adapters Guide](../guide/adapters.md) -- how adapters hook into the KickJS lifecycle
- [@forinda/kickjs-core](./core.md) -- DI container, injection tokens
- [Dependency Injection](../guide/dependency-injection.md) -- `@Inject` token usage
