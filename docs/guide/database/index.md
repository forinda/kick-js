# Database

`@forinda/kickjs-db` is the first-party database layer for KickJS — a code-first ORM built on top of [Kysely](https://kysely.dev). You declare your schema as TypeScript, get fully typed queries with zero codegen, and ship reversible migrations through the `kick db` CLI.

::: tip This is the database story for KickJS
`@forinda/kickjs-db` and its driver packages (`@forinda/kickjs-db-pg`, `@forinda/kickjs-db-sqlite`, `@forinda/kickjs-db-mysql`) are the supported, first-party way to talk to a SQL database from a KickJS app.
:::

## What you get

- **Code-first schema** — `table()`, typed column builders (`uuid()`, `varchar()`, `timestamp()`, …), `pgEnum()`, foreign keys, indexes, and `relations()`. One declaration drives both runtime SQL and TypeScript inference.
- **Typed client** — `createDbClient({ schema, dialect })` returns a `KickDbClient` whose `selectFrom` / `insertInto` / `updateTable` / `deleteFrom` are typed against your schema. No hand-written `interface DB`.
- **Relational queries** — `db.query.users.findMany({ with: { posts: true } })` compiles to a single JSON-aggregated query (no N+1).
- **Reversible migrations** — `kick db generate` diffs your schema and writes `up.sql` + `down.sql` + a snapshot; `kick db migrate latest` applies them with a lock table, batch tracking, and drift detection.
- **Lifecycle adapter** — `kickDbAdapter()` plugs migrations into `bootstrap()` and decides what to do about pending migrations on boot.
- **DI tokens** — inject the client anywhere with `@Inject(DB_PRIMARY)`.

## Install

Install the core package plus the driver for your database. Use `kick add`:

```bash
# PostgreSQL
kick add db db-pg

# SQLite
kick add db db-sqlite

# MySQL / MariaDB
kick add db db-mysql
```

Each driver package needs the underlying database client too:

```bash
pnpm add @forinda/kickjs-db @forinda/kickjs-db-pg pg          # PostgreSQL
pnpm add @forinda/kickjs-db @forinda/kickjs-db-sqlite better-sqlite3   # SQLite
pnpm add @forinda/kickjs-db @forinda/kickjs-db-mysql mysql2   # MySQL
```

See [Drivers](./drivers) for the differences between dialects.

## 1. Declare a schema

A schema is a plain module that exports `table()` declarations:

```ts
// src/db/schema.ts
import { table, uuid, varchar, timestamp } from '@forinda/kickjs-db'

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  name: varchar(120),
  createdAt: timestamp().notNull().defaultNow(),
})
```

The phantom type on each column flows through to the client, so `name` is `string | null` (nullable, no `.notNull()`) and `createdAt` is a generated `Date`. The full builder surface is covered in [Schema](./schema).

## 2. Add the `db:` config block

`kick.config.ts` carries a `db` block that the CLI reads for `kick db generate` and `kick db migrate*`:

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  db: {
    schemaPath: 'src/db/schema.ts',
    migrationsDir: 'db/migrations',
    dialect: 'postgres',
    connectionString: process.env.DATABASE_URL,
  },
})
```

| Field              | Default              | Purpose                                                      |
| ------------------ | -------------------- | ------------------------------------------------------------ |
| `schemaPath`       | `'src/db/schema.ts'` | Module that exports your `table()` / `pgEnum()` declarations |
| `migrationsDir`    | `'db/migrations'`    | Where `kick db generate` writes migration directories        |
| `dialect`          | `'postgres'`         | `'postgres' \| 'sqlite' \| 'mysql'`                          |
| `connectionString` | `$DATABASE_URL`      | Connection string for the built-in Postgres CLI adapter      |
| `adapter`          | —                    | Escape-hatch factory returning a custom `MigrationAdapter`   |

See [Migrations](./migrations) for the full workflow.

## 3. Create the client

`createDbClient` infers the database shape straight from the `schema` parameter — no manual generic:

```ts
// src/db/client.ts
import { Pool } from 'pg'
import { createDbClient } from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db-pg'
import * as schema from './schema'

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  events: true,
  slowQueryThresholdMs: 100,
})

// The same pool feeds the migration adapter — one pool, no duplicate connections.
export const migrationAdapter = pgAdapter({ pool })
```

## 4. Register the adapter in `bootstrap`

`kickDbAdapter()` is a standard KickJS adapter. It checks for pending migrations on boot and registers a shutdown hook that drains the pool:

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import { kickDbAdapter } from '@forinda/kickjs-db'
import { migrationAdapter } from './db/client'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    kickDbAdapter({
      migrationAdapter,
      migrationsDir: 'db/migrations',
      // Apply automatically in dev; fail fast everywhere else so a
      // deploy never silently mutates the schema.
      migrationsOnBoot: process.env.NODE_ENV === 'development' ? 'apply' : 'fail-if-pending',
    }),
  ],
})
```

`migrationsOnBoot` is one of:

- `'fail-if-pending'` (default) — throw on boot if any migration is pending. Operators run `kick db migrate latest` explicitly before a deploy lands.
- `'apply'` — run `migrateLatest()` automatically. Handy for dev / preview environments.
- `'ignore'` — boot regardless.

## 5. Make the client injectable

Register the client under the [DI token](#di-tokens) so any `@Service` / `@Repository` can inject it. The cleanest spot is a small module `register()`:

```ts
import { defineModule } from '@forinda/kickjs'
import { DB_PRIMARY } from '@forinda/kickjs-db'
import { db } from './db/client'

export const DbModule = defineModule({
  name: 'db',
  build: () => ({
    register(container) {
      container.registerFactory(DB_PRIMARY, () => db)
    },
  }),
})
```

To make the bare `KickDbClient` type resolve to your schema everywhere, augment `KickDbRegister` once (the `kick typegen` plugin can emit this for you — see [Schema Types](../db-schema-types)):

```ts
declare module '@forinda/kickjs-db' {
  interface KickDbRegister {
    db: typeof db
  }
}
```

## 6. First query

Inject the client and run a typed query. The query surface is Kysely's — `selectFrom`, `insertInto`, `updateTable`, `deleteFrom`:

```ts
import { Service, Inject } from '@forinda/kickjs'
import { DB_PRIMARY, type KickDbClient } from '@forinda/kickjs-db'

@Service()
export class UsersService {
  @Inject(DB_PRIMARY) private db!: KickDbClient

  create(email: string, name: string) {
    return this.db
      .insertInto('users')
      .values({ email, name }) // id + createdAt are generated — omit them
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  findByEmail(email: string) {
    return this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
  }
}
```

`row.email` is `string`, `row.createdAt` is `Date` — all inferred from the schema. See [Queries](./queries) for filtering, the relational `db.query` layer, transactions, and pagination.

## DI tokens

`@forinda/kickjs-db` ships three injection tokens in the reserved `kick/` namespace:

```ts
import { DB_PRIMARY, DB_REPLICA, DB_CLIENT } from '@forinda/kickjs-db'
```

- `DB_PRIMARY` — `kick/db/primary`. The default write client.
- `DB_REPLICA` — `kick/db/replica`. For read-replica setups.
- `DB_CLIENT` — an alias for `DB_PRIMARY`. Inject this if you only have one database and don't want to remember primary vs replica.

For sharded / multi-tenant setups, define your own token under your app's scope (e.g. `createToken<KickDbClient>('app/db/tenants')`) — the `kick/` prefix is reserved for first-party tokens.

## Where to go next

- [Schema](./schema) — tables, columns, enums, foreign keys, indexes, relations, custom types.
- [Queries](./queries) — the typed query builder, `db.query` relational layer, transactions, lifecycle events, pagination.
- [Migrations](./migrations) — `kick db generate`, the review gate, `kick db migrate latest/up/down/rollback/status`.
- [Drivers](./drivers) — Postgres vs SQLite vs MySQL, connection config, capability differences.
- [Repositories](./repositories) — implementing a generated `I<Name>Repository` interface against the client.
