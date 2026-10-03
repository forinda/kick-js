# Multi-Tenancy (BYO)

KickJS doesn't ship a first-party multi-tenant package — tenant resolution, scoping, and per-tenant DB switching are app-specific enough that the previous wrapper rarely fit a real adopter without modification. This guide shows how to compose tenant resolution from the framework's existing primitives: a `defineHttpContextDecorator` for resolution, `ContextMeta` augmentation for typing, and `getRequestValue` for service-level access.

::: tip This pattern is not tenant-only
"Tenant" here is a placeholder for any per-request scope your app cares about — workspace, organisation, team, project, room, deployment, region. Same recipe, different ContextMeta key.
:::

## Resolve the tenant via a Context Contributor

```ts
// src/contributors/tenant.context.ts
import { createToken, defineHttpContextDecorator, HttpException } from '@forinda/kickjs'

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
      (ctx.req.headers['x-tenant'] as string | undefined) ?? ctx.req.hostname.split('.')[0]

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
    const tenant = ctx.get('tenant') // typed
    ctx.json({ tenant })
  }
}

// In a service (no ctx reference)
@Service()
class BillingService {
  async chargeForFeature(feature: string) {
    const tenant = getRequestValue('tenant') // typed via ContextMeta
    if (!tenant) throw new Error('Outside a request frame')
    // ...
  }
}
```

## Keeping tenants apart in the database

With kick/db, [`defineTenancy()`](./database/tenancy.md) does the rest from the `tenant` value this contributor sets. Pick a strategy (a tenant column, row-level security, a schema or a database per tenant) and repositories need no tenant parameter:

```ts
export const tenancy = defineTenancy({ strategy: 'rls' }) // reads the request's `tenant`
export const db = createDbClient({ schema, tenancy, dialect: pgDialect({ pool }) })
```

The rest of this page shows the pieces underneath, for a database layer other than kick/db.

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

## Row-level security with kick/db (Postgres)

With a shared database, Postgres [row-level security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) makes the database enforce the tenant filter, so a query that forgets `where tenantId = …` still sees only one tenant's rows.

Declare the policy with the table ([Row-Level Security](./database/row-level-security.md)); migrations create it and turn RLS on:

```ts
import { policy } from '@forinda/kickjs-db/pg'

const tenant = `current_setting('app.tenant_id', true)`

export const notes = table(
  'notes',
  { id: serial().primaryKey(), tenantId: text().notNull(), body: text().notNull() },
  {
    rls: { force: true }, // the owner role too
    constraints: () => ({
      tenantIsolation: policy('tenant_isolation')
        .using(`"tenantId" = ${tenant}`)
        .withCheck(`"tenantId" = ${tenant}`),
    }),
  },
)
```

Set the tenant for the length of a transaction, and run the request's work inside it:

```ts
export function withTenant<T>(db: AppDb, tenantId: string, fn: () => Promise<T>) {
  // Local to this transaction: it can't leak to the next user of the connection.
  return db.transaction({ settings: { 'app.tenant_id': tenantId } }, () => fn())
}
```

```ts
@Get('/notes')
list(ctx: RequestContext) {
  return withTenant(this.db, ctx.get('tenant')!.id, () => this.notes.list())
}
```

`NotesRepository` needs no tenant parameter: [transactions follow the call chain](./database/transactions#transactions-follow-the-call-chain), so every query it runs on the injected client lands in the transaction that set `app.tenant_id`. Concurrent requests each get their own transaction and connection, so tenants can't see each other's setting even on a shared pool.

Three things to get right:

- **Connect as a role the policies apply to.** Superusers bypass row-level security, and so does the table's owner unless the table has `rls: { force: true }`. Or run migrations as the owner and the app as a separate role with only the grants it needs.
- **Outside `withTenant`, nothing is visible** — `current_setting(…, true)` is null (or `''` once a transaction on that connection has set it), so the policy matches no rows. That's the safe default. With `rls: { force: true }` the owner is held to the policy too, so admin jobs that need every tenant connect as a role with `BYPASSRLS` (with kick/db's tenancy, `tenancy.bypass()` on a `bypassDialect`), or go through a `SECURITY DEFINER` function.
- **Wrap in the handler or service, not a middleware.** A route middleware's `next()` can resolve before the handler finishes, so a transaction opened there may commit while the handler is still querying.

Writes are checked too: inserting a row for another tenant fails the policy's `WITH CHECK`. This recipe runs in kick/db's test suite against Postgres, as a non-owner role.

## Isolation strategies

| Strategy                 | How                                                    | Trade-offs                                                  |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------------------------- |
| **discriminator column** | every query filtered by tenant (`'column'` in kick/db) | cheapest; relies on every query being filtered              |
| **row-level security**   | the database filters (`'rls'`)                         | cheap; the database is the backstop; Postgres only          |
| **schema per tenant**    | each tenant's schema (`'schema'`)                      | strong isolation in one database; migrations run per tenant |
| **database per tenant**  | each tenant's database (`'database'`)                  | strongest isolation; most operations overhead               |

[Tenancy](./database/tenancy.md) compares them in detail.

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
        const sortedTop = [...requestsByTenant.entries()].sort(([, a], [, b]) => b - a).slice(0, 10)
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
