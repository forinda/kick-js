# @forinda/kickjs-multi-tenant

Multi-tenancy helpers for KickJS — tenant resolution, scoped DI, and database routing.

## Install

```bash
# Using the KickJS CLI (recommended)
kick add multi-tenant

# Manual install
pnpm add @forinda/kickjs-multi-tenant
```

## Features

- `TenantAdapter` — `defineAdapter`-built factory that resolves tenant from requests; supports `.scoped()` for sharded/multi-instance setups
- `TENANT_CONTEXT` token for injecting tenant info via DI (request-scoped via AsyncLocalStorage)
- `getCurrentTenant()` — functional helper for use outside DI
- Pluggable resolution strategies: header, subdomain, path, query, or custom
- Per-tenant database switching: database, schema, or discriminator modes
- `TENANT_DB` token for injecting per-tenant database connections
- Integration with `@forinda/kickjs-auth` for tenant-scoped RBAC

## Quick Example

```typescript
import { TenantAdapter, TENANT_CONTEXT, type TenantInfo } from '@forinda/kickjs-multi-tenant'
import { Inject, Service } from '@forinda/kickjs'

bootstrap({
  modules,
  adapters: [
    TenantAdapter({
      strategy: 'header',
      headerName: 'X-Tenant-ID',
    }),
  ],
})

// Access tenant in any service
@Service()
class DataService {
  @Inject(TENANT_CONTEXT) private tenant!: TenantInfo

  async getData() {
    return this.repo.findByTenant(this.tenant.id)
  }
}
```

### Multi-instance with `.scoped()`

For sharded tenants or independent tenant pipelines, use `TenantAdapter.scoped(scopeName, config)` to create an adapter instance with a namespaced name (`TenantAdapter:<scope>`) so `dependsOn` lookups stay unambiguous:

```typescript
adapters: [
  TenantAdapter.scoped('eu', { strategy: 'header', headerName: 'x-eu-tenant' }),
  TenantAdapter.scoped('us', { strategy: 'header', headerName: 'x-us-tenant' }),
]
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/)

## License

MIT
