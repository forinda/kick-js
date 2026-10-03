---
description: Multi-tenancy with kick/db — a tenant column, row-level security, a schema or a database per tenant, chosen with one defineTenancy() and no tenant code in handlers or repositories.
---

# Tenancy

One `defineTenancy()` says how tenants are kept apart. The schema and the client both take it, and from then on handlers, services and repositories contain no tenant code: every query runs as the current tenant.

```ts
// src/db/tenancy.ts
import { defineTenancy } from '@forinda/kickjs-db'

export const tenancy = defineTenancy({ strategy: 'rls' }) // or 'column', 'schema', 'database'
```

```ts
// src/db/schema.ts
import { serial, table, tenantKey, text } from '@forinda/kickjs-db'
import { tenancy } from './tenancy'

export const notes = table('notes', {
  id: serial().primaryKey(),
  tenantId: tenantKey(tenancy), // marks the table tenanted ('column' and 'rls')
  body: text().notNull(),
})
```

```ts
// src/db/client.ts
import { Pool } from 'pg'
import { createDbClient } from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'
import * as schema from './schema'
import { tenancy } from './tenancy'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
export const db = createDbClient({ schema, tenancy, dialect: pgDialect({ pool }) })

await db.selectFrom('notes').selectAll().execute() // the current tenant's notes
```

**The current tenant** comes from the request's `tenant` value: what a [context contributor](../multi-tenancy.md#resolve-the-tenant-via-a-context-contributor) such as `LoadTenant` sets, as `{ id }` or a string. Pass `current: () => …` to read it elsewhere. Outside a request (jobs, cron, scripts, tests), run code as a tenant explicitly:

```ts
await tenancy.run(job.data.tenantId, () => reports.build())
```

With no tenant in effect, queries on tenanted data fail rather than return everyone's rows (under `'rls'`, the database returns nothing).

## Choosing a strategy

| Strategy     | Isolation enforced by                  | Cost per tenant                | Dialects | Use it for                                                           |
| ------------ | -------------------------------------- | ------------------------------ | -------- | -------------------------------------------------------------------- |
| `'column'`   | kick/db adds the tenant to every query | none                           | all      | many small tenants, any database                                     |
| `'rls'`      | Postgres row-level security            | none                           | Postgres | the same, with the database as the backstop                          |
| `'schema'`   | each tenant's schema                   | a schema, migrated per tenant  | Postgres | tens to a few thousand tenants, per-tenant restore                   |
| `'database'` | separate databases                     | a database and its connections | all      | strict isolation, a SQLite/libsql/D1 file per tenant, data residency |

### `'column'`

Every `select`, `update` and `delete` on a tenanted table gets `tenantId = <current>`, joined tables included (in the join's `ON`, so a left join stays a left join), at every level of `db.query`. Inserts get the tenant filled in, and a row for another tenant is refused. Raw `sql` isn't rewritten.

### `'rls'`

The table gets row-level security, forced (your app usually connects as the owner), and a generated policy: `"tenantId" = nullif(current_setting('app.tenant_id', true), '')::<type>`. Inserts get the tenant filled in, and the database checks it. See [Row-Level Security](./row-level-security.md) for writing your own policies next to it.

How each connection gets the tenant is `binding`:

- **`'transaction'` (default):** the tenant is set locally to each transaction (`set_config(…, true)`). A query on its own runs in a short transaction (`BEGIN`, set, query, `COMMIT`), so it's three extra round trips. Wrap a unit of work in `db.transaction()` to pay that once. This is safe behind transaction-mode poolers (PgBouncer, Supavisor, Neon's pooler), which hand a server connection to other clients between transactions.
- **`'connection'`:** the tenant is set on the connection when it's handed out, only when it changes. It's faster, but only for a pool your app owns (node-postgres' `Pool`). Behind a transaction-mode pooler the setting would leak to the next client.

The app must not connect as a superuser or a `BYPASSRLS` role: row-level security never applies to those. The client checks on its first connection and throws (`roleCheck: 'warn' | 'off'` to relax it).

### `'schema'`

Each query goes to the tenant's schema (`schemaFor`, default `tenant_<id>`). No tenant column is needed. Already-qualified tables (`pgSchema('shared').table(...)`) stay where they are, which suits shared reference data.

### `'database'`

Each tenant's queries go to its own database. `dialectFor(id)` returns its dialect, called once per tenant; the connections are kept until `db.destroy()`. The client's own `dialect` is the central database (tenant registry, billing), used inside `bypass()`.

```ts
import { Pool } from 'pg'
import { defineTenancy } from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'

const tenancy = defineTenancy({
  strategy: 'database',
  dialectFor: (id) => pgDialect({ pool: new Pool({ connectionString: urlFor(id), max: 5 }) }),
})
```

## Cross-tenant work: `bypass`

```ts
await tenancy.bypass(() => billing.invoiceEveryone(), { reason: 'monthly billing run' })
```

- **What it does**, per strategy:
  - `'column'`: no tenant filter.
  - `'schema'`: no schema switch.
  - `'database'`: the central database.
  - `'rls'`: runs on `bypassDialect`, a connection as a role that bypasses row-level security, such as your migration role. Without one, `bypass` throws. The app's own role can't switch policies off, so SQL injection on it can't either. Bypass connections show as `application_name = kick-bypass` in `pg_stat_activity`.
- **A reason is required**, and every call goes to `onBypass({ reason, strategy, stack })` for your audit log.
- **Refused inside an HTTP request** unless `allowInRequest: true`, so a route can't quietly see every tenant.

For a narrow cross-tenant read that runs often (counts per tenant, say), a Postgres `SECURITY DEFINER` function in a schema the app can't write is tighter than a bypass role.

## Migrations per tenant

`'column'` and `'rls'` migrate like any app: one schema. `'schema'` and `'database'` run the same migrations for every tenant. Each tenant keeps its own `kick_migrations`, so a new tenant, or one that failed, catches up on the next run:

```ts
// kick.config.ts — inside defineConfig({ … })
import { Pool } from 'pg'
import { pgAdapter } from '@forinda/kickjs-db/pg'

db: {
  dialect: 'postgres',
  tenants: {
    list: () => tenantIds(), // from the central database
    adapter: async (id) => {
      const schema = `tenant_${id}`
      await central.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` })
      return pgAdapter({ pool, schema, endPoolOnClose: true })
    },
  },
}
```

```bash
kick db migrate latest --tenants # ✓ / ✗ per tenant; a failure doesn't stop the rest
```

`migrateTenants({ tenants, adapterFor, migrationsDir, concurrency })` does the same from code, for a deploy script or when a tenant signs up.

## Background jobs

A job dispatched as a tenant runs as that tenant: tenancy is a [job context carrier](../jobs.md#job-context), so the tenant travels with the job and is restored around its handler. This works with `QueueAdapter`'s dispatcher, and with your own dispatcher once it calls `stampJobContext(data)`.

```ts
await jobs.dispatch('reports', 'build', { month }) // inside a request for tenant acme

@Process('build')
build(job: Job<{ month: string }>) {
  return this.reports.build(job.data.month) // queries run as acme
}
```

Jobs started some other way (cron, a script) use `tenancy.run(id, fn)`.

## What it costs

Measured on Postgres 16, per read, through the typed client (`__tests__/bench/tenancy-binding-pg.test.ts`, run with `KICK_BENCH=1`):

|                                                                 | Local   | 1 ms round trip |
| --------------------------------------------------------------- | ------- | --------------- |
| No tenancy                                                      | 0.23 ms | 1.5 ms          |
| `'rls'`, `'connection'` binding, lone queries (tenant changing) | 0.38 ms | 3.3 ms          |
| `'rls'`, `'transaction'` binding, lone queries                  | 0.47 ms | 4.2 ms          |
| `'rls'`, `'transaction'` binding, 10 per `db.transaction()`     | 0.24 ms | 1.8 ms          |

A lone query under `'transaction'` binding is three round trips (`BEGIN` with the tenant, the query, `COMMIT`), so latency, not the policy, is the cost. Wrap a request's queries in one `db.transaction()` and it's close to no tenancy at all. `'connection'` binding sends the tenant only when it changes on that connection, so it's cheapest when a connection keeps serving the same tenant.

`'column'` adds a `WHERE` clause and costs nothing measurable. Index the tenant column, or lead composite indexes with it.

## Many databases: closing idle ones

With `'database'`, each tenant's connections stay open while it's busy, and close after `tenantIdleMs` without use (default 10 minutes). `maxOpenTenants` caps how many tenants keep connections at once: when a new tenant arrives, the least recently used idle one is closed. Tenants with a query in flight are never closed, so it's a soft cap. A closed tenant reopens on its next query.
