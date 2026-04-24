# @forinda/kickjs-multi-tenant

> [!WARNING] Deprecated — going private in v4.1.2.
> This package is being retired. The replacement is a short BYO recipe using `defineAdapter` / `definePlugin` from `@forinda/kickjs` directly — see **[guide/multi-tenancy](https://forinda.github.io/kick-js/guide/multi-tenancy)** for the copy-paste alternative.
>
> The package still works in v4.1.x; v4.1.2 will remove it from the public registry. Migrate at your convenience.

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
