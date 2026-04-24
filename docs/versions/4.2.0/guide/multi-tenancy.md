# Multi-Tenancy (BYO)

KickJS doesn't ship a first-party multi-tenant package — tenant resolution, scoping, and per-tenant DB switching are app-specific enough that the previous wrapper rarely fit a real adopter without modification. This guide shows how to compose tenant resolution from the framework's existing primitives: a `defineHttpContextDecorator` for resolution, `ContextMeta` augmentation for typing, and `getRequestValue` for service-level access.

::: tip This pattern is not tenant-only
"Tenant" here is a placeholder for any per-request scope your app cares about — workspace, organisation, team, project, room, deployment, region. Same recipe, different ContextMeta key.
:::

## Resolve the tenant via a Context Contributor

```ts
// src/contributors/tenant.context.ts
import {
  createToken,
  defineHttpContextDecorator,
  HttpException,
} from '@forinda/kickjs'

export interface Tenant {
  id: string
  name: string
  plan: 'free' | 'pro' | 'enterprise'
}

export interface TenantRepo {
  findBySlug(slug: string): Promise<Tenant | null>
}

export const TENANT_REPO = createToken<TenantRepo>('app/tenants/repository')

declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenant: Tenant
  }
}

export const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  deps: { repo: TENANT_REPO },
  resolve: async (ctx, { repo }) => {
    // Pick whatever resolution strategy fits — header, subdomain, JWT claim, URL param.
    const slug =
      (ctx.req.headers['x-tenant'] as string | undefined) ??
      ctx.req.hostname.split('.')[0]

    const tenant = await repo.findBySlug(slug)
    if (!tenant) throw new HttpException(404, `Unknown tenant: ${slug}`)
    return tenant
  },
})
```

Mount it globally so every route has `tenant` resolved:

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import { LoadTenant } from './contributors/tenant.context'

export const app = await bootstrap({
  modules,
  contributors: [LoadTenant.registration],
})
```

## Read it from anywhere

```ts
// In a controller
@Controller()
class DashboardController {
  @Get('/dashboard')
  show(ctx: RequestContext) {
    const tenant = ctx.get('tenant')                    // typed
    ctx.json({ tenant })
  }
}

// In a service (no ctx reference)
@Service()
class BillingService {
  async chargeForFeature(feature: string) {
    const tenant = getRequestValue('tenant')            // typed via ContextMeta
    if (!tenant) throw new Error('Outside a request frame')
    // ...
  }
}
```

## Per-tenant database switching

Bind a tenant-scoped DB factory in a plugin, then resolve it inside any service that needs to query as the active tenant:

```ts
// src/plugins/tenant-db.plugin.ts
import { createToken, definePlugin, getRequestValue, Scope } from '@forinda/kickjs'
import type { Database } from 'your-orm'
import { resolveDbForTenant } from './lib/db'

export const TENANT_DB = createToken<Database>('app/db/tenant')

export const TenantDbPlugin = definePlugin({
  name: 'TenantDbPlugin',
  build: () => ({
    register(container) {
      // REQUEST-scoped: one Database instance per request, per tenant.
      // The resolver runs once per request thanks to scope caching.
      container.registerFactory(
        TENANT_DB,
        () => {
          const tenant = getRequestValue('tenant')
          if (!tenant) throw new Error('TENANT_DB resolved outside a request frame')
          return resolveDbForTenant(tenant.id)
        },
        Scope.REQUEST,
      )
    },
  }),
})
```

```ts
// In a repository
@Repository()
class OrdersRepo {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}
  // every query here runs against the active tenant's DB
}
```

The `Scope.REQUEST` registration ensures the factory runs once per request and the result is cached for the rest of the request lifecycle, regardless of how many services inject `TENANT_DB`.

## Three isolation strategies

The previous package surfaced three modes; all three are still natural with the recipe above — just swap the `resolveDbForTenant` body:

| Mode | What `resolveDbForTenant(id)` returns | Trade-offs |
|---|---|---|
| **database-per-tenant** | A fresh Drizzle/Prisma client connected to that tenant's database. Cache the client by tenant id at module scope so we don't reconnect per request. | Strongest isolation; most ops overhead (one DB per tenant). |
| **schema-per-tenant** (Postgres) | The shared client with `schema: 'tenant_<id>'` set. | Strong isolation; one DB cluster. |
| **discriminator column** | The shared client; every query gets a `WHERE tenant_id = $id` clause via a query builder hook. | Cheapest; relies on app code never forgetting the predicate. |

Pick at the application boundary; the contributor + plugin recipe stays the same.

## DevTools integration

Track resolved-tenant traffic on the DevTools dashboard by wrapping the contributor in a tiny adapter that exposes `introspect()`:

```ts
import { defineAdapter } from '@forinda/kickjs'
import type { IntrospectionSnapshot } from '@forinda/kickjs-devtools-kit'
import { LoadTenant } from '../contributors/tenant.context'

export const TenantObservabilityAdapter = defineAdapter({
  name: 'TenantObservabilityAdapter',
  build: () => {
    const requestsByTenant = new Map<string, number>()

    return {
      contributors() {
        // Re-export the contributor through the adapter so adopters
        // mount this single adapter to get both the tenant resolution
        // AND the DevTools panel.
        return [LoadTenant.registration]
      },

      introspect(): IntrospectionSnapshot {
        const sortedTop = [...requestsByTenant.entries()]
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
        return {
          protocolVersion: 1,
          name: 'TenantObservabilityAdapter',
          kind: 'adapter',
          state: { topTenants: Object.fromEntries(sortedTop) },
          metrics: {
            uniqueTenants: requestsByTenant.size,
            totalRequests: [...requestsByTenant.values()].reduce((s, n) => s + n, 0),
          },
        }
      },
    }
  },
})
```

Increment `requestsByTenant` from a follow-up contributor that depends on `'tenant'` (or from a global middleware that reads `getRequestValue('tenant')`).

## What you give up by going BYO

The previous `@forinda/kickjs-multi-tenant` package added:

1. **Subdomain / header / custom resolver helpers** — replaced by your one-line resolution inside `resolve()`.
2. **`req.tenant` mutation + 403 short-circuit** — replaced by throwing `HttpException(404)` from the resolver, which lands in the global error handler.
3. **Tenant-aware RBAC integration** — wire your `AuthAdapter` to `getRequestValue('tenant')` from inside a custom strategy.

Everything else was middleware glue.

## Related

- [Context Decorators](./context-decorators.md) — typed per-request values, full pipeline reference
- [Plugins](./plugins.md) — `definePlugin` for DI registration
- [Dependency Injection](./dependency-injection.md) — `Scope.REQUEST` semantics
