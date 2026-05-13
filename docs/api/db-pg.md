# @forinda/kickjs-db-pg

PostgreSQL peer adapter for [`@forinda/kickjs-db`](./db.md). Built on `node-postgres` (`pg`); provides both the query dialect and the migration runner's `MigrationAdapter`.

## Installation

```bash
pnpm add @forinda/kickjs-db-pg pg
pnpm add -D @types/pg
```

Peer of `@forinda/kickjs-db@workspace:^` — bump them together.

## Quick Start

```ts
import { bootstrap } from '@forinda/kickjs'
import { kickDbAdapter, DB_PRIMARY } from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db-pg'

export const app = await bootstrap({
  modules,
  adapters: [
    kickDbAdapter({
      schema,
      adapter: pgAdapter({ connectionString: process.env.DATABASE_URL, max: 20 }),
      migrationsOnBoot: 'fail-if-pending',
      events: true,
    }),
  ],
})
```

## `pgAdapter(options)`

Returns an adapter implementing both `MigrationAdapter` (for the runner) and the query-dialect surface (for query execution). Pass to `kickDbAdapter({ adapter: ... })`.

### `PgAdapterOptions`

| Option             | Type                   | Default    | Description                                                            |
| ------------------ | ---------------------- | ---------- | ---------------------------------------------------------------------- |
| `connectionString` | `string`               | —          | Standard `postgres://user:pass@host:port/db` URL                       |
| `pool`             | `Pool`                 | —          | Pre-built `pg.Pool` instance — supply this OR `connectionString`       |
| `client`           | `Client`               | —          | Pre-built `pg.Client` — useful for tests / single-connection scenarios |
| `max`              | `number`               | `10`       | Pool size when constructed from `connectionString`                     |
| `ssl`              | `pg.PoolConfig['ssl']` | —          | Forward to `pg.Pool` constructor                                       |
| `schema`           | `string`               | `'public'` | PG schema namespace used for migrations + introspection                |

Exactly one of `connectionString` / `pool` / `client` must be supplied.

### Type-only exports

- `PgPoolLike` — minimal shape `pgAdapter` accepts (mirror `pg.Pool`'s connect / end / query).
- `PgClientLike` — minimal shape `pgAdapter` accepts (mirror `pg.Client`'s connect / end / query).

Use these when stubbing for unit tests without booting a real pool.

## `pgDialect(options)`

Standalone dialect — use when you want `createDbClient()` directly without the `kickDbAdapter` wrapper (custom DI flows, test harnesses).

```ts
import { createDbClient } from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db-pg'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
```

### `PgDialectOptions`

| Option   | Type     | Description                                              |
| -------- | -------- | -------------------------------------------------------- |
| `pool`   | `Pool`   | A `pg.Pool` (preferred — connection reuse + parallelism) |
| `client` | `Client` | A single `pg.Client` (tests / scripts)                   |

## PG-specific column types

Subpath import: `@forinda/kickjs-db/pg`.

```ts
import { tsvector, vector, citext, money, inet, cidr, xml } from '@forinda/kickjs-db/pg'

const articles = table('articles', {
  id: serial().primaryKey(),
  fts: tsvector().notNull(),
  embedding: vector(384),
  email_ci: citext(),
  price: money(),
  ip: inet(),
  network: cidr(),
  payload: xml(),
})
```

## Migration runner integration

`pgAdapter()` implements `MigrationAdapter` from `@forinda/kickjs-db`, so it plugs directly into `migrateLatest({ adapter, ... })` and the `kick db migrate` CLI.

```ts
import { migrateLatest } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db-pg'

const adapter = pgAdapter({ connectionString })
try {
  const r = await migrateLatest({ adapter, migrationsDir: 'db/migrations' })
  console.log(`Applied batch ${r.batch}:`, r.applied)
} finally {
  await adapter.cleanup()
}
```

## Dialect capabilities

| Capability                          | PG support                                             |
| ----------------------------------- | ------------------------------------------------------ |
| Transactions                        | ✅                                                     |
| Savepoints                          | ✅                                                     |
| Streaming via cursor                | ✅                                                     |
| `pg_cancel_backend` for AbortSignal | ✅ (when `db.query.*({ signal })` is used)             |
| ENUM types (`pgEnum`)               | ✅                                                     |
| `tsvector` / `vector` / `citext`    | ✅ via `@forinda/kickjs-db/pg`                         |
| Composite types                     | Read-only (referenced via `detectCompositeReferences`) |

## Exports

`pgAdapter`, `pgDialect`. Type-only: `PgAdapterOptions`, `PgDialectOptions`, `PgPoolLike`, `PgClientLike`.
