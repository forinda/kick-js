# @forinda/kickjs-multi-tenant

Multi-tenancy for KickJS — tenant resolution from header/subdomain/path/query/custom, request-scoped DI via AsyncLocalStorage, and per-tenant DB routing through the `prisma` / `drizzle` tenant adapters.

## Install

```bash
kick add multi-tenant
```

## Quick Example

```ts
import { bootstrap } from '@forinda/kickjs'
import { TenantAdapter, TENANT_CONTEXT, type TenantInfo } from '@forinda/kickjs-multi-tenant'
import { Inject, Service } from '@forinda/kickjs'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [TenantAdapter({ strategy: 'header', headerName: 'X-Tenant-ID' })],
})

@Service()
class DataService {
  constructor(@Inject(TENANT_CONTEXT) private tenant: TenantInfo) {}
  getData() { return this.repo.findByTenant(this.tenant.id) }
}
```

For sharded / multi-realm setups use `TenantAdapter.scoped('eu', { ... })` — name composes as `TenantAdapter:eu` so `dependsOn` lookups stay unambiguous.

## Documentation

[forinda.github.io/kick-js/guide/multi-tenancy](https://forinda.github.io/kick-js/guide/multi-tenancy)

## License

MIT
