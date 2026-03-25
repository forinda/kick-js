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

- `TenantAdapter` — lifecycle adapter that resolves tenant from requests
- `TENANT_CONTEXT` token for injecting tenant info via DI
- Pluggable resolution strategies: header, subdomain, path, or custom
- Scoped DI for per-tenant service instances

## Quick Example

```typescript
import { TenantAdapter, TENANT_CONTEXT, type TenantInfo } from '@forinda/kickjs-multi-tenant'
import { Inject, Service } from '@forinda/kickjs-core'

bootstrap({
  modules,
  adapters: [
    new TenantAdapter({
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

## Documentation

[Full documentation](https://forinda.github.io/kick-js/)

## License

MIT
